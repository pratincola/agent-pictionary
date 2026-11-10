/**
 * RoomActor: one async serial queue per room (PLAN.md §9, D4). Every event
 * that touches room state is enqueued here; the actor assigns `seq` as it
 * dequeues, runs the pure engine step, then executes the effects. This is the
 * only place where wall-clock time enters the engine (`now` on events and
 * setTimeout for `schedule` effects).
 */
import {
  allowedForRole,
  createRoom,
  type Effect,
  handleRoomEvent,
  inAudience,
  type RoomEvent,
  type RoomInit,
  type RoomState,
  type SessionInfo,
  type SessionTarget,
  viewerOf,
  viewRoom,
} from "@pictionary/engine";
import {
  type ClientMessage,
  type RoomStateSnapshot,
  ServerMessage,
  type ServerMessageBody,
} from "@pictionary/protocol";
import type { Logger } from "pino";
import type { Metrics } from "../metrics.js";
import type { EventBus, RoomSnapshot } from "./infra.js";
import { roomChannel } from "./infra.js";
import { Lru } from "./lru.js";
import type { Persistence } from "./persistence.js";

/** What the actor needs from a transport connection. */
export interface Connection {
  readonly sessionId: string;
  readonly info: SessionInfo;
  send(json: string): void;
  close(code: number, reason: string): void;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type QueuedEvent = DistributiveOmit<RoomEvent, "seq" | "now">;

export interface ActorDeps {
  log: Logger;
  persistence: Persistence;
  bus: EventBus;
  roomId: string;
  validateOutgoing?: boolean;
  metrics?: Metrics;
  onStatusChange?: (status: RoomState["status"]) => void;
  onIdle?: () => void;
  /** Called after a step that changed durable room state (lobby, round end, match end). */
  onSnapshot?: (snapshot: Omit<RoomSnapshot, "nodeId" | "savedAt">) => void;
}

/** Broadcasts after which a restart should be able to restore the room. */
const SNAPSHOT_AFTER = new Set([
  "room.playerJoined",
  "room.playerLeft",
  "match.started",
  "round.ended",
  "match.ended",
]);

interface Queued {
  event: QueuedEvent;
  /** For client events: resolve when processed (tests + idempotent replay). */
  done?: () => void;
}

export class RoomActor {
  state: RoomState;
  private queue: Queued[] = [];
  private draining = false;
  private readonly connections = new Map<string, Connection>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Fire times of pending timers, saved in snapshots so a restart can re-arm them. */
  private readonly timerAt = new Map<string, number>();
  private roundStartedAt: number | undefined;
  /** sessionId -> (client id -> replies sent for it). */
  private readonly idempotency = new Map<string, Lru<string, ServerMessageBody[]>>();
  private closed = false;
  private idleTimer: NodeJS.Timeout | undefined;
  readonly code: string;
  readonly roomId: string;
  private readonly log: Logger;

  constructor(
    init: RoomInit | { restore: RoomSnapshot },
    private readonly deps: ActorDeps,
  ) {
    this.state = "restore" in init ? init.restore.state : createRoom(init);
    this.code = this.state.code;
    this.roomId = deps.roomId;
    this.log = deps.log.child({ room: this.code });
    if ("restore" in init) {
      // Re-arm engine timers; one that is already due fires at once.
      for (const t of init.restore.timers) this.schedule(t.timerId, t.at);
      // Every socket is gone after a restart; let the engine see the departures.
      for (const s of Object.values(this.state.sessions)) {
        if (s.connected) this.enqueue({ kind: "session.leave", sessionId: s.sessionId });
      }
    }
  }

  get seq(): number {
    return this.state.seq;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  /** Snapshot payload for the manager (state + pending timers). */
  snapshot(): Omit<RoomSnapshot, "nodeId" | "savedAt"> {
    return {
      roomId: this.roomId,
      state: this.state,
      timers: [...this.timerAt.entries()].map(([timerId, at]) => ({ timerId, at })),
    };
  }

  // ---------------------------------------------------------------------------
  // Transport hooks
  // ---------------------------------------------------------------------------

  attach(conn: Connection): void {
    if (this.closed) {
      conn.close(4404, "room closed");
      return;
    }
    const prev = this.connections.get(conn.sessionId);
    if (prev && prev !== conn) prev.close(4001, "superseded by a new connection");
    this.connections.set(conn.sessionId, conn);
    if (!prev) this.deps.metrics?.sessionsConnected.inc({ role: conn.info.role });
    this.enqueue({ kind: "session.join", session: conn.info });
  }

  detach(conn: Connection): void {
    if (this.connections.get(conn.sessionId) !== conn) return; // already superseded
    this.connections.delete(conn.sessionId);
    this.deps.metrics?.sessionsConnected.dec({ role: conn.info.role });
    this.enqueue({ kind: "session.leave", sessionId: conn.sessionId });
  }

  /** Enqueue a validated client message. Resolves once the actor processed it. */
  submit(sessionId: string, message: ClientMessage, recvNs: bigint): Promise<void> {
    return new Promise((resolve) => {
      this.enqueue({ kind: "client", sessionId, message, recvNs: recvNs.toString() }, resolve);
    });
  }

  enqueue(event: QueuedEvent, done?: () => void): void {
    if (this.closed) {
      done?.();
      return;
    }
    this.queue.push(done ? { event, done } : { event });
    if (!this.draining) void this.drain();
  }

  /** Read-only snapshot for REST (GET /rooms/:code, /ops). Never mutate. */
  peek(): RoomState {
    return this.state;
  }

  /**
   * Graceful close: stop accepting, let the queue drain (every accepted
   * event is processed and persisted), then drop timers and sockets.
   */
  async close(): Promise<void> {
    this.closed = true;
    while (this.draining) await new Promise((r) => setTimeout(r, 5));
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const c of this.connections.values()) {
      this.deps.metrics?.sessionsConnected.dec({ role: c.info.role });
      c.close(1001, "server shutting down");
    }
    this.connections.clear();
  }

  // ---------------------------------------------------------------------------
  // The single lane
  // ---------------------------------------------------------------------------

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift() as Queued;
        try {
          await this.step(item.event);
        } catch (err) {
          this.log.error({ err, kind: item.event.kind }, "actor step failed");
        } finally {
          item.done?.();
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async step(partial: QueuedEvent): Promise<void> {
    // Idempotency: a repeated client `id` replays the original replies.
    if (partial.kind === "client") {
      const replies = this.idempotency.get(partial.sessionId)?.get(partial.message.id);
      if (replies) {
        for (const r of replies) this.sendTo(partial.sessionId, r, this.state.seq);
        return;
      }
    }
    const seq = this.state.seq + 1;
    const now = Date.now();
    const event = { ...partial, seq, now } as RoomEvent;
    const prevStatus = this.state.status;
    const { state, effects } = handleRoomEvent(this.state, event);
    this.state = state;

    const replies: ServerMessageBody[] = [];
    let snapshotDue = false;
    for (const e of effects) {
      if (e.kind === "broadcast" && SNAPSHOT_AFTER.has(e.message.type)) snapshotDue = true;
      await this.execute(e, seq, event, replies);
    }
    if (event.kind === "client" && (event.message.type !== "ping" || replies.length > 0)) {
      let lru = this.idempotency.get(event.sessionId);
      if (!lru) {
        lru = new Lru(256);
        this.idempotency.set(event.sessionId, lru);
      }
      lru.set(event.message.id, replies);
    }
    if (state.status !== prevStatus) this.deps.onStatusChange?.(state.status);
    if (snapshotDue && this.deps.onSnapshot) this.deps.onSnapshot(this.snapshot());
    if (event.kind === "session.leave" && this.connections.size === 0) this.scheduleIdle();
    if (event.kind === "session.join" && this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private scheduleIdle() {
    if (!this.deps.onIdle || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.connections.size === 0) this.deps.onIdle?.();
    }, 60_000);
    this.idleTimer.unref();
  }

  private async execute(
    e: Effect,
    seq: number,
    event: RoomEvent,
    replies: ServerMessageBody[],
  ): Promise<void> {
    switch (e.kind) {
      case "send": {
        const targets = this.resolve(e.to);
        if (e.message.type === "guess.result")
          this.deps.metrics?.guesses.inc({ result: e.message.payload.result });
        for (const sid of targets) {
          this.sendTo(sid, e.message, seq);
          if (
            event.kind === "client" &&
            sid === event.sessionId &&
            e.message.replyTo === event.message.id
          ) {
            replies.push(e.message);
          }
        }
        return;
      }
      case "broadcast": {
        const msg = this.stamp(e.message, seq);
        const json = JSON.stringify(msg);
        let sent = 0;
        for (const c of this.connections.values()) {
          if (!inAudience(e.audience, c.info.role)) continue;
          if (!allowedForRole(e.message, c.info.role)) continue;
          this.safeSend(c, json);
          sent++;
        }
        const metrics = this.deps.metrics;
        if (metrics) {
          if (sent > 0) metrics.wsMessages.inc({ direction: "out" }, sent);
          if (event.kind === "client" && event.recvNs) {
            const ns = Number(process.hrtime.bigint() - BigInt(event.recvNs));
            metrics.broadcastLatency.observe(ns / 1e9);
          }
          if (e.message.type === "draw.op") metrics.drawOps.inc();
          else if (e.message.type === "round.started") this.roundStartedAt = msg.ts;
          else if (e.message.type === "round.ended" && this.roundStartedAt !== undefined) {
            metrics.roundDuration.observe((msg.ts - this.roundStartedAt) / 1000);
            this.roundStartedAt = undefined;
          }
        }
        // Relay nodes serve spectators only, so only the spectator-visible subset leaves the node.
        if (inAudience(e.audience, "spectator"))
          void this.deps.bus.publish(roomChannel(this.code), json).catch(() => {});
        return;
      }
      case "persist":
        // Awaited: the write lands before any later effect (the broadcast) runs.
        await this.deps.persistence.write({ roomId: this.roomId }, e.record);
        return;
      case "schedule":
        this.schedule(e.timerId, e.at);
        return;
      case "close": {
        const c = this.connections.get(e.sessionId);
        if (c) {
          this.connections.delete(e.sessionId);
          this.sendTo(
            e.sessionId,
            { type: "error", payload: { code: e.code, message: e.message } },
            seq,
            c,
          );
          c.close(4000 + closeCodeFor(e.code), e.message);
        }
        return;
      }
    }
  }

  private schedule(timerId: string, at: number): void {
    const delay = Math.max(0, at - Date.now());
    const prev = this.timers.get(timerId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.timers.delete(timerId);
      this.timerAt.delete(timerId);
      this.enqueue({ kind: "tick", timerId });
    }, delay);
    this.timers.set(timerId, t);
    this.timerAt.set(timerId, at);
  }

  private resolve(to: SessionTarget): string[] {
    if ("sessionId" in to) return [to.sessionId];
    const out: string[] = [];
    for (const c of this.connections.values()) {
      if ("agentId" in to && c.info.role === "agent" && c.info.agentId === to.agentId)
        out.push(c.sessionId);
      else if (
        "humansOfAgent" in to &&
        c.info.role === "human" &&
        c.info.agentId === to.humansOfAgent
      )
        out.push(c.sessionId);
    }
    return out;
  }

  private stamp(body: ServerMessageBody, seq: number): ServerMessage {
    const msg = { ...body, seq, ts: Date.now() } as ServerMessage;
    if (this.deps.validateOutgoing) {
      const r = ServerMessage.safeParse(msg);
      if (!r.success) {
        this.log.error(
          { issues: r.error.issues, type: body.type },
          "outgoing message violates protocol",
        );
        throw new Error(`outgoing ${body.type} violates protocol: ${r.error.message}`);
      }
    }
    return msg;
  }

  private sendTo(sessionId: string, body: ServerMessageBody, seq: number, conn?: Connection): void {
    const c = conn ?? this.connections.get(sessionId);
    if (!c) return;
    if (!allowedForRole(body, c.info.role)) {
      this.log.error({ type: body.type, role: c.info.role }, "blocked message to agent");
      return;
    }
    this.safeSend(c, JSON.stringify(this.stamp(body, seq)));
    this.deps.metrics?.wsMessages.inc({ direction: "out" });
  }

  private safeSend(c: Connection, json: string) {
    try {
      c.send(json);
    } catch (err) {
      this.log.warn({ err, session: c.sessionId }, "send failed");
    }
  }

  /** Current snapshot for a viewer, used for REST reads. */
  snapshotFor(info: SessionInfo): RoomStateSnapshot {
    return viewRoom(this.state, viewerOf(info));
  }
}

function closeCodeFor(code: string): number {
  switch (code) {
    case "ROOM_FULL":
      return 3;
    case "WRONG_PHASE":
      return 9;
    case "UNAUTHORIZED":
      return 1;
    default:
      return 0;
  }
}

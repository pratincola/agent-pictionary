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
import type { EventBus } from "./infra.js";
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
  onStatusChange?: (status: RoomState["status"]) => void;
  onIdle?: () => void;
}

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
  /** sessionId -> (client id -> replies sent for it). */
  private readonly idempotency = new Map<string, Lru<string, ServerMessageBody[]>>();
  private closed = false;
  private idleTimer: NodeJS.Timeout | undefined;
  readonly code: string;
  readonly roomId: string;
  private readonly log: Logger;

  constructor(
    init: RoomInit,
    private readonly deps: ActorDeps,
  ) {
    this.state = createRoom(init);
    this.code = init.code;
    this.roomId = deps.roomId;
    this.log = deps.log.child({ room: init.code });
  }

  get seq(): number {
    return this.state.seq;
  }

  get connectionCount(): number {
    return this.connections.size;
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
    this.enqueue({ kind: "session.join", session: conn.info });
  }

  detach(conn: Connection): void {
    if (this.connections.get(conn.sessionId) !== conn) return; // already superseded
    this.connections.delete(conn.sessionId);
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

  async close(): Promise<void> {
    this.closed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const c of this.connections.values()) c.close(1001, "server shutting down");
    this.connections.clear();
    // Let an in-flight step finish.
    while (this.draining) await new Promise((r) => setTimeout(r, 5));
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
    for (const e of effects) {
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
        for (const c of this.connections.values()) {
          if (!inAudience(e.audience, c.info.role)) continue;
          if (!allowedForRole(e.message, c.info.role)) continue;
          this.safeSend(c, json);
        }
        void this.deps.bus.publish(roomChannel(this.code), msg).catch(() => {});
        return;
      }
      case "persist":
        // Awaited: the write lands before any later effect (the broadcast) runs.
        await this.deps.persistence.write({ roomId: this.roomId }, e.record);
        return;
      case "schedule": {
        const delay = Math.max(0, e.at - Date.now());
        const prev = this.timers.get(e.timerId);
        if (prev) clearTimeout(prev);
        const t = setTimeout(() => {
          this.timers.delete(e.timerId);
          this.enqueue({ kind: "tick", timerId: e.timerId });
        }, delay);
        this.timers.set(e.timerId, t);
        return;
      }
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

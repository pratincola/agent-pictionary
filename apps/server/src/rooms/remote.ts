/**
 * RemoteRoom: a read-only relay for spectators whose socket landed on a node
 * that does not own the room (PLAN.md §9.6). It subscribes to the owner's
 * fan-out channel, fetches one spectator snapshot from the owner over REST,
 * and forwards the exact JSON the owner broadcast. Nothing here touches room
 * state; the single writer stays on the owning node.
 */
import type { RoomStateSnapshot, ServerMessage } from "@pictionary/protocol";
import type { Logger } from "pino";
import type { Metrics } from "../metrics.js";
import type { Connection } from "./actor.js";
import { type EventBus, roomChannel, roomControlChannel } from "./infra.js";

export interface RemoteRoomDeps {
  log: Logger;
  bus: EventBus;
  metrics?: Metrics;
  /** Spectator-redacted snapshot from the owning node (null when the room is gone). */
  fetchSnapshot: () => Promise<RoomStateSnapshot | null>;
  /** Called when the last spectator leaves or the owner closed the room. */
  onEmpty: () => void;
}

interface Pending {
  conn: Connection;
  buffer: string[];
}

export class RemoteRoom {
  private readonly live = new Map<string, Connection>();
  private readonly pending = new Map<string, Pending>();
  private unsubscribe: (() => Promise<void>)[] = [];
  private subscribed: Promise<void> | undefined;
  private lastSeq = 0;
  private closed = false;
  private readonly log: Logger;

  constructor(
    readonly code: string,
    private readonly deps: RemoteRoomDeps,
  ) {
    this.log = deps.log.child({ room: code, relay: true });
  }

  get connectionCount(): number {
    return this.live.size + this.pending.size;
  }

  async attach(conn: Connection): Promise<void> {
    if (this.closed) {
      conn.close(4404, "room closed");
      return;
    }
    if (conn.info.role !== "spectator") {
      conn.close(4001, "only spectators may attach to a relay node");
      return;
    }
    const prev = this.live.get(conn.sessionId) ?? this.pending.get(conn.sessionId)?.conn;
    if (prev && prev !== conn) prev.close(4001, "superseded by a new connection");
    this.live.delete(conn.sessionId);
    const pending: Pending = { conn, buffer: [] };
    this.pending.set(conn.sessionId, pending);
    if (!prev) this.deps.metrics?.sessionsConnected.inc({ role: "spectator" });
    try {
      await this.ensureSubscribed();
      const snap = await this.deps.fetchSnapshot();
      if (this.pending.get(conn.sessionId) !== pending) return; // superseded meanwhile
      if (!snap) {
        this.pending.delete(conn.sessionId);
        this.deps.metrics?.sessionsConnected.dec({ role: "spectator" });
        conn.close(4404, "room not found on its node");
        return;
      }
      const state: ServerMessage = {
        type: "room.state",
        seq: snap.seq,
        ts: Date.now(),
        payload: { ...snap, you: { sessionId: conn.sessionId, role: "spectator" } },
      };
      conn.send(JSON.stringify(state));
      let sent = 1;
      for (const raw of pending.buffer) {
        const seq = seqOf(raw);
        if (seq !== undefined && seq <= snap.seq) continue; // already in the snapshot
        conn.send(raw);
        sent++;
      }
      this.deps.metrics?.wsMessages.inc({ direction: "out" }, sent);
      this.pending.delete(conn.sessionId);
      this.live.set(conn.sessionId, conn);
    } catch (err) {
      this.log.warn({ err }, "relay attach failed");
      this.pending.delete(conn.sessionId);
      this.deps.metrics?.sessionsConnected.dec({ role: "spectator" });
      conn.close(1011, "relay unavailable");
      this.maybeEmpty();
    }
  }

  detach(conn: Connection): void {
    const wasLive = this.live.get(conn.sessionId) === conn;
    const wasPending = this.pending.get(conn.sessionId)?.conn === conn;
    if (!wasLive && !wasPending) return;
    this.live.delete(conn.sessionId);
    this.pending.delete(conn.sessionId);
    this.deps.metrics?.sessionsConnected.dec({ role: "spectator" });
    this.maybeEmpty();
  }

  /** Spectators only ever ping; everything else is refused without touching state. */
  handle(conn: Connection, type: string | undefined, id: string | undefined): void {
    const reply = id ? { replyTo: id } : {};
    const body: ServerMessage =
      type === "ping"
        ? { type: "pong", ...reply, seq: this.lastSeq, ts: Date.now(), payload: {} }
        : {
            type: "error",
            ...reply,
            seq: this.lastSeq,
            ts: Date.now(),
            payload: { code: "NOT_IN_ROOM", message: "spectators on a relay node can only ping" },
          };
    conn.send(JSON.stringify(body));
    this.deps.metrics?.wsMessages.inc({ direction: "out" });
  }

  async close(code = 4404, reason = "room closed"): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const subs = this.unsubscribe;
    this.unsubscribe = [];
    await Promise.all(subs.map((u) => u().catch(() => {})));
    for (const c of this.live.values()) {
      this.deps.metrics?.sessionsConnected.dec({ role: "spectator" });
      c.close(code, reason);
    }
    for (const p of this.pending.values()) {
      this.deps.metrics?.sessionsConnected.dec({ role: "spectator" });
      p.conn.close(code, reason);
    }
    this.live.clear();
    this.pending.clear();
  }

  private ensureSubscribed(): Promise<void> {
    if (!this.subscribed) {
      this.subscribed = (async () => {
        const u1 = await this.deps.bus.subscribe(roomChannel(this.code), (raw) =>
          this.onEvent(raw),
        );
        const u2 = await this.deps.bus.subscribe(roomControlChannel(this.code), (raw) => {
          if (raw.includes("room.closed")) {
            void this.close().then(() => this.deps.onEmpty());
          }
        });
        this.unsubscribe.push(u1, u2);
      })();
    }
    return this.subscribed;
  }

  private onEvent(raw: string): void {
    if (this.closed) return;
    const seq = seqOf(raw);
    if (seq !== undefined && seq > this.lastSeq) this.lastSeq = seq;
    for (const p of this.pending.values()) p.buffer.push(raw);
    for (const c of this.live.values()) c.send(raw);
    if (this.live.size > 0) this.deps.metrics?.wsMessages.inc({ direction: "out" }, this.live.size);
  }

  private maybeEmpty(): void {
    if (this.connectionCount === 0 && !this.closed) {
      void this.close(1001, "relay idle").then(() => this.deps.onEmpty());
    }
  }
}

/** Cheap seq extraction for the short buffering window; full parse is not needed. */
function seqOf(raw: string): number | undefined {
  const m = /"seq":(\d+)/.exec(raw);
  return m ? Number(m[1]) : undefined;
}

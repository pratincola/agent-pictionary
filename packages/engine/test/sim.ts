/**
 * Deterministic in-memory simulator for engine tests. Plays the role of the
 * server's room actor: assigns seq, routes effects to sessions, holds timers.
 */
import {
  type ClientMessage,
  type Entitlement,
  PictionaryConfig,
  type PictionaryConfigInput,
  type Role,
  type ServerMessageBody,
} from "@pictionary/protocol";
import {
  createRoom,
  type Effect,
  handleRoomEvent,
  inAudience,
  type PersistRecord,
  type RoomEvent,
  type RoomState,
  type SessionInfo,
} from "../src/index.js";

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type QueuedEvent = DistributiveOmit<RoomEvent, "seq" | "now">;

export interface Delivered {
  seq: number;
  message: ServerMessageBody;
}

export class Sim {
  state: RoomState;
  seq = 0;
  now: number;
  log: RoomEvent[] = [];
  effects: Effect[] = [];
  inbox = new Map<string, Delivered[]>();
  timers: { at: number; timerId: string }[] = [];
  persisted: PersistRecord[] = [];
  closed: { sessionId: string; code: string }[] = [];
  private sessions = new Map<string, SessionInfo>();
  private counter = 0;

  constructor(config: PictionaryConfigInput = {}, seed = 42, now = 1_000_000) {
    this.now = now;
    this.state = createRoom({ code: "TEST42", config: PictionaryConfig.parse(config), seed });
  }

  /** Apply one event through the engine, record effects, deliver messages. */
  apply(partial: QueuedEvent & { now?: number }): Effect[] {
    const seq = ++this.seq;
    const now = partial.now ?? this.now;
    const event = { ...partial, seq, now } as RoomEvent;
    this.log.push(event);
    const res = handleRoomEvent(this.state, event);
    this.state = res.state;
    for (const e of res.effects) this.exec(e, seq);
    this.effects.push(...res.effects);
    return res.effects;
  }

  private exec(e: Effect, seq: number) {
    switch (e.kind) {
      case "send": {
        const targets: string[] = [];
        if ("sessionId" in e.to) targets.push(e.to.sessionId);
        else if ("agentId" in e.to) {
          for (const s of this.sessions.values())
            if (s.role === "agent" && s.agentId === e.to.agentId) targets.push(s.sessionId);
        } else {
          for (const s of this.sessions.values())
            if (s.role === "human" && s.agentId === e.to.humansOfAgent) targets.push(s.sessionId);
        }
        for (const t of targets) this.deliver(t, seq, e.message);
        break;
      }
      case "broadcast":
        for (const s of this.sessions.values()) {
          if (inAudience(e.audience, s.role)) this.deliver(s.sessionId, seq, e.message);
        }
        break;
      case "persist":
        this.persisted.push(e.record);
        break;
      case "schedule":
        this.timers.push({ at: e.at, timerId: e.timerId });
        break;
      case "close":
        this.closed.push({ sessionId: e.sessionId, code: e.code });
        this.sessions.delete(e.sessionId);
        break;
    }
  }

  private deliver(sessionId: string, seq: number, message: ServerMessageBody) {
    const box = this.inbox.get(sessionId) ?? [];
    box.push({ seq, message });
    this.inbox.set(sessionId, box);
  }

  join(info: Omit<SessionInfo, "sessionId"> & { sessionId?: string }): string {
    const sessionId = info.sessionId ?? `s${++this.counter}`;
    const full: SessionInfo = { ...info, sessionId };
    this.sessions.set(sessionId, full);
    this.apply({ kind: "session.join", session: full });
    return sessionId;
  }

  joinAgent(agentId: string, entitlements: Entitlement[] = [], creator = false): string {
    const info: SessionInfo = {
      sessionId: "",
      role: "agent",
      agentId,
      agentName: `Agent ${agentId}`,
      entitlements,
    };
    if (creator) info.creator = true;
    const { sessionId: _ignored, ...rest } = info;
    return this.join(rest);
  }

  joinHuman(humanId: string, agentId?: string): string {
    const rest: Omit<SessionInfo, "sessionId"> = { role: "human" as Role, humanId };
    if (agentId) rest.agentId = agentId;
    return this.join(rest);
  }

  joinSpectator(): string {
    return this.join({ role: "spectator" });
  }

  leave(sessionId: string) {
    this.sessions.delete(sessionId);
    this.apply({ kind: "session.leave", sessionId });
  }

  send(sessionId: string, message: Omit<ClientMessage, "id" | "ts"> & { id?: string }): Effect[] {
    const id = message.id ?? `m${++this.counter}`;
    const full = { ...message, id, ts: this.now } as ClientMessage;
    return this.apply({ kind: "client", sessionId, message: full });
  }

  /** Fire the earliest pending timer (advancing `now` to it). */
  fireNext(): string | undefined {
    this.timers.sort((a, b) => a.at - b.at);
    const t = this.timers.shift();
    if (!t) return undefined;
    this.now = Math.max(this.now, t.at);
    this.apply({ kind: "tick", timerId: t.timerId });
    return t.timerId;
  }

  /** Fire a specific pending timer by prefix, e.g. "drawing:0". */
  fire(prefix: string): boolean {
    const i = this.timers.findIndex((t) => t.timerId.startsWith(prefix));
    if (i < 0) return false;
    const [t] = this.timers.splice(i, 1);
    if (!t) return false;
    this.now = Math.max(this.now, t.at);
    this.apply({ kind: "tick", timerId: t.timerId });
    return true;
  }

  messages(sessionId: string, type?: ServerMessageBody["type"]): Delivered[] {
    const box = this.inbox.get(sessionId) ?? [];
    return type ? box.filter((d) => d.message.type === type) : box;
  }

  last<T extends ServerMessageBody["type"]>(
    sessionId: string,
    type: T,
  ): Extract<ServerMessageBody, { type: T }> | undefined {
    const m = this.messages(sessionId, type).at(-1);
    return m?.message as Extract<ServerMessageBody, { type: T }> | undefined;
  }

  get round() {
    return this.state.game?.round;
  }

  /** The drawer's secret word (test-only peek). */
  get word(): string {
    return this.state.game?.round?.word ?? "";
  }
}

/** Build a room with N agents in `drawing` phase. Returns ids. */
export function roomInDrawing(n: number, config: PictionaryConfigInput = {}, seed = 42) {
  const sim = new Sim({ chooseSeconds: 20, drawSeconds: 90, revealSeconds: 5, ...config }, seed);
  const agents = Array.from({ length: n }, (_, i) => `a${i}`);
  const sessions: Record<string, string> = {};
  for (const a of agents) sessions[a] = sim.joinAgent(a, [], a === "a0");
  for (const a of agents) sim.send(sessions[a] as string, { type: "room.ready", payload: {} });
  const drawer = sim.round?.drawerAgentId as string;
  sim.send(sessions[drawer] as string, { type: "word.choose", payload: { index: 0 } });
  return { sim, agents, sessions, drawer, guessers: agents.filter((a) => a !== drawer) };
}

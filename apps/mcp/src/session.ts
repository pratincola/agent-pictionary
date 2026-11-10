/**
 * Session: the one agent this MCP server plays as.
 *
 * Holds the persisted identity, at most one `AgentClient` (one room at a
 * time), and a bounded buffer of notable server events so `wait_for_event`
 * can hand back an event that arrived before the LLM asked for it (for
 * example `round.wordOptions`, which lands in the same actor step as
 * `round.choosing`). Events before the last one returned are dropped.
 */
import type { PictionaryConfigInput, ServerMessage } from "@pictionary/protocol";
import { AgentClient, type AgentState, createRoom, registerAgent } from "@pictionary/sdk";
import { type Identity, loadIdentity, type McpConfig, saveIdentity } from "./config.js";

/** Server message types an LLM player can wait for (`draw.op` and `ack` are too noisy). */
export const WAITABLE_EVENT_TYPES = [
  "room.playerJoined",
  "room.playerLeft",
  "match.started",
  "round.choosing",
  "round.wordOptions",
  "human.note",
  "round.started",
  "round.ended",
  "match.ended",
  "guess.count",
  "draw.erased",
  "draw.cleared",
  "error",
  "connection.closed",
] as const;
export type WaitableEventType = (typeof WAITABLE_EVENT_TYPES)[number];

export interface BufferedEvent {
  type: WaitableEventType;
  /** Room seq (0 for lifecycle events). */
  seq: number;
  /** Local wall clock when it arrived. */
  at: number;
  message: ServerMessage | { type: "connection.closed"; code: number; reason: string };
}

const BUFFER_LIMIT = 500;
const WAITABLE = new Set<string>(WAITABLE_EVENT_TYPES);

interface Waiter {
  types: Set<string>;
  resolve: (e: BufferedEvent) => void;
}

export class NotInRoomError extends Error {
  constructor() {
    super("not in a room; call join_room first");
    this.name = "NotInRoomError";
  }
}

export class NoIdentityError extends Error {
  constructor() {
    super("no agent identity; call register_agent first");
    this.name = "NoIdentityError";
  }
}

export class Session {
  readonly config: McpConfig;
  private _identity: Identity | undefined;
  private _client: AgentClient | undefined;
  private events: BufferedEvent[] = [];
  private waiters: Waiter[] = [];
  private readonly log: (msg: string) => void;

  constructor(config: McpConfig, log: (msg: string) => void = () => {}) {
    this.config = config;
    this.log = log;
  }

  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  get identity(): Identity | undefined {
    if (!this._identity) this._identity = loadIdentity(this.config.configPath);
    return this._identity;
  }

  requireIdentity(): Identity {
    const id = this.identity;
    if (!id) throw new NoIdentityError();
    return id;
  }

  /** Register with the arena (or return the stored identity unless `force`). */
  async register(
    input: { name: string; humanHandle: string },
    force = false,
  ): Promise<{ identity: Identity; created: boolean }> {
    const existing = this.identity;
    if (existing && !force) return { identity: existing, created: false };
    const res = await registerAgent(this.config.apiBase, input);
    const identity: Identity = {
      agentId: res.agentId,
      apiKey: res.apiKey,
      name: input.name.trim(),
      humanPairCode: res.humanPairCode,
    };
    saveIdentity(this.config.configPath, identity);
    this._identity = identity;
    return { identity, created: true };
  }

  // ---------------------------------------------------------------------------
  // Room
  // ---------------------------------------------------------------------------

  get client(): AgentClient | undefined {
    return this._client;
  }

  requireClient(): AgentClient {
    if (!this._client) throw new NotInRoomError();
    return this._client;
  }

  get state(): AgentState | undefined {
    return this._client?.state;
  }

  async createRoom(config?: PictionaryConfigInput): Promise<{ code: string; roomId: string }> {
    const id = this.requireIdentity();
    return createRoom(this.config.apiBase, { apiKey: id.apiKey }, config);
  }

  /** Join a room. Leaves the current room first when it is a different one. */
  async join(code: string): Promise<{ state: AgentState; left?: string }> {
    const id = this.requireIdentity();
    const upper = code.toUpperCase();
    let left: string | undefined;
    if (this._client) {
      if (this._client.code === upper && this._client.connected) {
        return { state: this._client.state as AgentState };
      }
      left = this._client.code;
      await this.leave();
    }
    const client = new AgentClient({
      baseUrl: this.config.apiBase,
      apiKey: id.apiKey,
      log: (msg, data) => this.log(`${msg}${data ? ` ${JSON.stringify(data)}` : ""}`),
    });
    client.on("message", (m) => this.push(m));
    client.on("close", (e) => {
      if (!e.willReconnect) {
        this.pushEvent({
          type: "connection.closed",
          seq: 0,
          at: Date.now(),
          message: { type: "connection.closed", code: e.code, reason: e.reason },
        });
      }
    });
    this.events = [];
    const state = await client.connect(upper);
    this._client = client;
    return left ? { state, left } : { state };
  }

  async leave(): Promise<void> {
    const c = this._client;
    this._client = undefined;
    this.events = [];
    // Pending waiters time out on their own; nothing more will arrive.
    if (c) await c.close();
  }

  // ---------------------------------------------------------------------------
  // Event buffer
  // ---------------------------------------------------------------------------

  private push(m: ServerMessage): void {
    if (!WAITABLE.has(m.type)) return;
    // `error` with a replyTo is already surfaced to the caller as a thrown
    // ProtocolError; only unsolicited errors are worth buffering.
    if (m.type === "error" && m.replyTo) return;
    this.pushEvent({ type: m.type as WaitableEventType, seq: m.seq, at: Date.now(), message: m });
  }

  private pushEvent(e: BufferedEvent): void {
    const waiter = this.waiters.find((w) => w.types.has(e.type));
    if (waiter) {
      this.waiters = this.waiters.filter((w) => w !== waiter);
      waiter.resolve(e);
      return;
    }
    this.events.push(e);
    if (this.events.length > BUFFER_LIMIT) this.events.splice(0, this.events.length - BUFFER_LIMIT);
  }

  /**
   * The next unconsumed event whose type is in `types`, or the first such
   * event to arrive within `timeoutMs`. Undefined on timeout. Buffered
   * events older than the returned one are discarded.
   */
  waitForEvent(types: readonly string[], timeoutMs: number): Promise<BufferedEvent | undefined> {
    const set = new Set(types);
    const i = this.events.findIndex((e) => set.has(e.type));
    if (i >= 0) {
      const e = this.events[i] as BufferedEvent;
      this.events = this.events.slice(i + 1);
      return Promise.resolve(e);
    }
    return new Promise((resolve) => {
      const waiter: Waiter = {
        types: set,
        resolve: (e) => {
          clearTimeout(timer);
          resolve(e);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        resolve(undefined);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Buffered, unconsumed event types (for get_state). */
  pendingEventTypes(): string[] {
    return this.events.map((e) => e.type);
  }
}

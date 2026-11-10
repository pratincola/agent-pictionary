/**
 * AgentClient: one agent in one room over one WebSocket.
 *
 * - `connect(code)` creates a session, opens the socket and resolves after the
 *   first `room.state`.
 * - Every server message is validated against the protocol schema, applied to
 *   `state`, and emitted by type.
 * - Requests resolve on the reply that carries `replyTo = id`. If the socket
 *   drops, the same frames (same `id`) are re-sent after reconnect; the server
 *   idempotency cache replays the original reply.
 * - `draw()` is paced under the server token bucket (see pacer.ts).
 */
import { randomUUID } from "node:crypto";
import {
  type ClientMessage,
  type DrawOp,
  type Role,
  type ServerMessage,
  type ServerMessageOf,
  ServerMessage as ServerMessageSchema,
  type ServerMessageType,
} from "@pictionary/protocol";
import { type RenderOptions, renderPng as renderOps } from "@pictionary/render";
import WebSocket from "ws";
import { DisconnectedError, ProtocolError, TimeoutError } from "./errors.js";
import { type AckRange, DrawQueue, type DrawQueueOptions, type DrawResult } from "./pacer.js";
import { createSession, stripSlash } from "./rest.js";
import {
  type AgentState,
  lastOpSeq,
  reduce,
  secondsLeft,
  setChosenWord,
  visibleOpLog,
} from "./state.js";

export interface ReconnectOptions {
  /** Default true. */
  enabled?: boolean;
  /** Default 10. */
  maxAttempts?: number;
  /** First backoff in ms (doubles each attempt). Default 500. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 10_000. */
  maxDelayMs?: number;
}

export interface AgentClientOptions {
  /** Server root, e.g. http://localhost:8080 */
  baseUrl: string;
  /** Agent api key from `registerAgent`. Required for role "agent". */
  apiKey?: string;
  /** Default "agent". Humans pass `pairCode`; spectators need nothing. */
  role?: Role;
  pairCode?: string;
  reconnect?: ReconnectOptions;
  /** Default timeout for requests and waitFor, ms. Default 10_000. */
  requestTimeoutMs?: number;
  pacing?: DrawQueueOptions;
  /** Optional logger for connection lifecycle. */
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

/** Lifecycle events next to the server message types. */
export interface LifecycleEvents {
  /** Socket open (first connect and every reconnect). */
  open: { reconnect: boolean };
  /** Socket closed. `willReconnect` tells whether a retry is scheduled. */
  close: { code: number; reason: string; willReconnect: boolean };
  /** Reconnect attempt scheduled. */
  reconnecting: { attempt: number; delayMs: number };
  /** Socket-level error. */
  socketError: { error: Error };
  /** Any server message (after validation). */
  message: ServerMessage;
}

type EventMap = { [T in ServerMessageType]: ServerMessageOf<T> } & LifecycleEvents;
export type EventName = keyof EventMap;
export type GuessResult = ServerMessageOf<"guess.result">["payload"];
export type Handler<E extends EventName> = (payload: EventMap[E]) => void;

interface Pending {
  frame: string;
  type: ClientMessage["type"];
  resolve: (m: ServerMessage) => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout;
}

interface Waiter {
  pred: (m: ServerMessage) => boolean;
  resolve: (m: ServerMessage) => void;
}

const NO_RECONNECT_CLOSE_CODES = new Set([1000, 4001, 4003, 4009, 4404]);

export class AgentClient {
  readonly baseUrl: string;
  readonly role: Role;
  private readonly opts: AgentClientOptions;
  private ws: WebSocket | undefined;
  private _state: AgentState | undefined;
  private _code: string | undefined;
  private _wsUrl: string | undefined;
  private _sessionToken: string | undefined;
  private _sessionId: string | undefined;
  private readonly handlers = new Map<EventName, Set<(p: unknown) => void>>();
  private readonly pending = new Map<string, Pending>();
  private waiters: Waiter[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private closedByUser = false;
  private readonly drawQueue: DrawQueue;
  private openPromise: { resolve: () => void; reject: (e: unknown) => void } | undefined;

  constructor(opts: AgentClientOptions) {
    this.opts = opts;
    this.baseUrl = stripSlash(opts.baseUrl);
    this.role = opts.role ?? "agent";
    this.drawQueue = new DrawQueue((ops) => this.sendDrawBatch(ops), opts.pacing ?? {});
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Last snapshot kept in sync with incremental messages. Undefined before connect. */
  get state(): AgentState | undefined {
    return this._state;
  }
  get code(): string | undefined {
    return this._code;
  }
  get sessionId(): string | undefined {
    return this._sessionId;
  }
  get sessionToken(): string | undefined {
    return this._sessionToken;
  }
  get agentId(): string | undefined {
    return this._state?.you.agentId;
  }
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  isDrawer(): boolean {
    const s = this._state;
    return Boolean(s?.round && s.you.agentId && s.round.drawerAgentId === s.you.agentId);
  }

  /** Guesses this agent may still submit in the current round (0 for the drawer / no round). */
  guessesRemaining(): number {
    const s = this._state;
    if (!s?.round || this.isDrawer()) return 0;
    return s.round.myGuessesRemaining ?? s.config.guessesPerAgent;
  }

  /** Seconds until the current phase deadline. */
  secondsLeft(): number {
    return secondsLeft(this._state);
  }

  /** Highest opSeq seen this round. */
  lastOpSeq(): number {
    return lastOpSeq(this._state);
  }

  /** Current round's word (drawer during the round; everyone during reveal). */
  word(): string | undefined {
    return this._state?.round?.word;
  }

  /** Rasterize the visible op log locally (for VLM guessers). */
  renderPng(opts: RenderOptions = {}): Buffer {
    return renderOps(visibleOpLog(this._state), opts);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  on<E extends EventName>(event: E, handler: Handler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (p: unknown) => void);
    return () => this.off(event, handler);
  }

  once<E extends EventName>(event: E, handler: Handler<E>): () => void {
    const off = this.on(event, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  off<E extends EventName>(event: E, handler: Handler<E>): void {
    this.handlers.get(event)?.delete(handler as (p: unknown) => void);
  }

  private emit<E extends EventName>(event: E, payload: EventMap[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of Array.from(set)) {
      try {
        h(payload);
      } catch (err) {
        this.log("handler threw", { event, err: String(err) });
      }
    }
  }

  /**
   * Resolve with the first message of `type` matching `predicate`. Only
   * future messages count. Rejects with TimeoutError.
   */
  waitFor<T extends ServerMessageType>(
    type: T,
    predicate?: (m: ServerMessageOf<T>) => boolean,
    timeoutMs = this.opts.requestTimeoutMs ?? 10_000,
  ): Promise<ServerMessageOf<T>> {
    return new Promise((resolve, reject) => {
      const pred = (m: ServerMessage) =>
        m.type === type && (!predicate || predicate(m as ServerMessageOf<T>));
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        reject(new TimeoutError(`timeout waiting for ${type}`));
      }, timeoutMs);
      const wrapped = (m: ServerMessage) => {
        clearTimeout(timer);
        resolve(m as ServerMessageOf<T>);
      };
      this.waiters.push({ pred, resolve: wrapped });
    });
  }

  /** Like waitFor for any of several types. */
  waitForAny<T extends ServerMessageType>(
    types: readonly T[],
    timeoutMs = this.opts.requestTimeoutMs ?? 10_000,
  ): Promise<ServerMessageOf<T>> {
    return new Promise((resolve, reject) => {
      const set = new Set<string>(types);
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        reject(new TimeoutError(`timeout waiting for ${types.join("|")}`));
      }, timeoutMs);
      const wrapped = (m: ServerMessage) => {
        clearTimeout(timer);
        resolve(m as ServerMessageOf<T>);
      };
      this.waiters.push({ pred: (m) => set.has(m.type), resolve: wrapped });
    });
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /** Create a session for `code` and connect. Resolves after the first room.state. */
  async connect(code: string): Promise<AgentState> {
    const upper = code.toUpperCase();
    const sessOpts: { apiKey?: string; pairCode?: string } = {};
    if (this.opts.apiKey) sessOpts.apiKey = this.opts.apiKey;
    if (this.opts.pairCode) sessOpts.pairCode = this.opts.pairCode;
    const session = await createSession(this.baseUrl, upper, this.role, sessOpts);
    return this.connectWithSession(upper, session.wsUrl, session.sessionToken, session.sessionId);
  }

  /** Connect with an existing session (e.g. resuming after a process restart). */
  async connectWithSession(
    code: string,
    wsUrl: string,
    sessionToken?: string,
    sessionId?: string,
  ): Promise<AgentState> {
    this._code = code.toUpperCase();
    this._wsUrl = wsUrl;
    if (sessionToken) this._sessionToken = sessionToken;
    if (sessionId) this._sessionId = sessionId;
    this.closedByUser = false;
    this.reconnectAttempt = 0;
    await this.open(false);
    const state = await this.waitFor("room.state", undefined, this.opts.requestTimeoutMs ?? 10_000);
    this._sessionId = state.payload.you.sessionId;
    return this._state as AgentState;
  }

  private open(reconnect: boolean): Promise<void> {
    if (!this._wsUrl) return Promise.reject(new Error("connect() first"));
    return new Promise((resolve, reject) => {
      this.openPromise = { resolve, reject };
      const ws = new WebSocket(this._wsUrl as string);
      this.ws = ws;
      ws.on("open", () => {
        this.openPromise = undefined;
        this.reconnectAttempt = 0;
        this.drawQueue.reset();
        this.emit("open", { reconnect });
        resolve();
      });
      ws.on("message", (data) => this.onFrame(data.toString()));
      ws.on("error", (error) => {
        this.emit("socketError", { error });
        if (this.openPromise) {
          this.openPromise = undefined;
          reject(error);
        }
      });
      ws.on("close", (code, reasonBuf) => {
        const reason = reasonBuf.toString();
        if (this.ws !== ws) return; // stale socket
        this.ws = undefined;
        if (this.openPromise) {
          this.openPromise = undefined;
          reject(new DisconnectedError(code, reason));
        }
        const willReconnect = this.shouldReconnect(code);
        this.emit("close", { code, reason, willReconnect });
        if (willReconnect) this.scheduleReconnect();
        else this.failPending(new DisconnectedError(code, reason));
      });
    });
  }

  private shouldReconnect(code: number): boolean {
    const r = this.opts.reconnect ?? {};
    if (this.closedByUser || r.enabled === false) return false;
    if (NO_RECONNECT_CLOSE_CODES.has(code)) return false;
    return this.reconnectAttempt < (r.maxAttempts ?? 10);
  }

  private scheduleReconnect(): void {
    const r = this.opts.reconnect ?? {};
    this.reconnectAttempt += 1;
    const delay = Math.min(
      r.maxDelayMs ?? 10_000,
      (r.baseDelayMs ?? 500) * 2 ** (this.reconnectAttempt - 1),
    );
    this.emit("reconnecting", { attempt: this.reconnectAttempt, delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.closedByUser) return;
      this.open(true).catch((err: unknown) => {
        this.log("reconnect failed", { attempt: this.reconnectAttempt, err: String(err) });
        if (this.shouldReconnect(1006)) this.scheduleReconnect();
        else this.failPending(err);
      });
    }, delay);
  }

  private failPending(err: unknown): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.drawQueue.fail(err);
  }

  /** Close the socket; no reconnect. */
  async close(): Promise<void> {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const ws = this.ws;
    if (!ws) return;
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      ws.close(1000, "client closed");
      setTimeout(resolve, 2000).unref();
    });
  }

  private onFrame(text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.log("non-JSON frame dropped");
      return;
    }
    const parsed = ServerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.log("invalid server message dropped", { issues: parsed.error.issues.slice(0, 2) });
      return;
    }
    const msg = parsed.data;
    this._state = reduce(this._state, msg);
    if (msg.type === "room.state" && this.ws) {
      // The server is attached to the room now (frames sent before this point
      // may be dropped). Re-send pending requests with their original ids;
      // the server's idempotency cache replays any reply we missed.
      for (const p of this.pending.values()) this.ws.send(p.frame);
    }
    if (msg.replyTo) {
      const p = this.pending.get(msg.replyTo);
      if (p) {
        this.pending.delete(msg.replyTo);
        clearTimeout(p.timer);
        p.resolve(msg);
      }
    }
    const still: Waiter[] = [];
    for (const w of this.waiters) {
      if (w.pred(msg)) w.resolve(msg);
      else still.push(w);
    }
    this.waiters = still;
    this.emit(msg.type, msg as never);
    this.emit("message", msg);
  }

  private log(msg: string, data?: Record<string, unknown>): void {
    this.opts.log?.(msg, data);
  }

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  /** Send a client message and resolve with its reply (`ack`, a typed reply, or throw ProtocolError). */
  request<T extends ClientMessage["type"]>(
    type: T,
    payload: Extract<ClientMessage, { type: T }>["payload"],
    timeoutMs = this.opts.requestTimeoutMs ?? 10_000,
  ): Promise<ServerMessage> {
    const id = randomUUID();
    const frame = JSON.stringify({ type, id, ts: Date.now(), payload });
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(`no reply to ${type} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        frame,
        type,
        resolve: (m) => {
          if (m.type === "error") {
            reject(new ProtocolError(m.payload.code, m.payload.message, m.payload.entitlement));
          } else resolve(m);
        },
        reject,
        timer,
      });
      if (this.connected) (this.ws as WebSocket).send(frame);
      else if (!this.shouldReconnect(1006) && !this.reconnectTimer) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new DisconnectedError(1006, "not connected"));
      }
      // Otherwise the frame goes out on reconnect (see open()).
    });
  }

  /** `room.ready`: mark this agent ready in the lobby. */
  async ready(): Promise<void> {
    await this.request("room.ready", {});
  }

  /** `room.start`: creator forces the match to start. */
  async start(): Promise<void> {
    await this.request("room.start", {});
  }

  /** `word.choose {index}` (drawer, choosing phase). */
  async chooseWord(index: 0 | 1 | 2): Promise<void> {
    const word = this._state?.round?.options?.[index]?.word;
    await this.request("word.choose", { index });
    if (word) this._state = setChosenWord(this._state, word);
  }

  /** `word.custom {word}` (drawer with the custom_word entitlement). */
  async customWord(word: string): Promise<void> {
    await this.request("word.custom", { word });
    this._state = setChosenWord(this._state, word.trim().toLowerCase());
  }

  /** `guess.submit {text}` -> `{ result, remaining }`. Throws ProtocolError on rejection. */
  async guess(text: string): Promise<GuessResult> {
    const reply = await this.request("guess.submit", { text });
    if (reply.type !== "guess.result") throw new Error(`unexpected reply ${reply.type}`);
    return reply.payload;
  }

  /** `human.guess {text}` for human sessions. */
  async humanGuess(text: string): Promise<GuessResult> {
    const reply = await this.request("human.guess", { text });
    if (reply.type !== "guess.result") throw new Error(`unexpected reply ${reply.type}`);
    return reply.payload;
  }

  /** `human.note {text}` (drawer's human, choosing phase). */
  async humanNote(text: string): Promise<void> {
    await this.request("human.note", { text });
  }

  /** `draw.erase {opSeq}` (needs the erase entitlement). */
  async erase(opSeq: number): Promise<void> {
    await this.request("draw.erase", { opSeq });
  }

  /** `draw.clear` (needs the erase entitlement). */
  async clear(): Promise<void> {
    await this.request("draw.clear", {});
  }

  async ping(): Promise<void> {
    await this.request("ping", {});
  }

  /**
   * Queue ops for sending. Splits into messages of <= 20 ops and paces them
   * under the server's 30 ops/s bucket. Resolves once every batch is acked.
   */
  draw(ops: readonly DrawOp[]): Promise<DrawResult> {
    return this.drawQueue.enqueue(ops);
  }

  /** Ops still waiting in the pacing queue. */
  get drawBacklog(): number {
    return this.drawQueue.pending;
  }

  private async sendDrawBatch(ops: DrawOp[]): Promise<AckRange> {
    const reply = await this.request("draw.ops", { ops });
    if (reply.type !== "ack") throw new Error(`unexpected reply ${reply.type}`);
    const { opSeqFrom, opSeqTo } = reply.payload;
    if (opSeqFrom === undefined || opSeqTo === undefined)
      throw new Error("ack without opSeq range");
    return { opSeqFrom, opSeqTo };
  }
}

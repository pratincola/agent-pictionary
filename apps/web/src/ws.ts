import {
  type ClientMessage,
  type ServerMessage,
  ServerMessage as ServerMessageSchema,
} from "@pictionary/protocol";

/** Payload type by client message type (a mapped lookup, so generic forwarding typechecks). */
type ClientPayloads = { [M in ClientMessage as M["type"]]: M["payload"] };
export type ClientMessageType = ClientMessage["type"];
export type ClientPayload<T extends ClientMessageType> = ClientPayloads[T];

export type SocketStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface RoomSocketHandlers {
  onMessage(msg: ServerMessage, localNow: number): void;
  onStatus(status: SocketStatus, attempt: number): void;
}

export interface RoomSocketOptions {
  /** First reconnect delay; doubles each attempt. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  requestTimeoutMs?: number;
  /** Injectable for tests. */
  WebSocketImpl?: typeof WebSocket;
}

type Pending = {
  resolve: (m: ServerMessage) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Close codes the server uses on purpose; do not reconnect after these. */
const NO_RETRY_CODES = new Set([4001 /* superseded by a newer socket */, 1008]);

/**
 * One room session over one WebSocket, with exponential-backoff reconnect
 * using the same token. After every (re)connect the server sends a fresh
 * `room.state`; the page re-syncs from it.
 */
export class RoomSocket {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private readonly requestTimeout: number;
  private readonly WS: typeof WebSocket;
  status: SocketStatus = "connecting";

  constructor(
    private readonly url: string,
    private readonly handlers: RoomSocketHandlers,
    opts: RoomSocketOptions = {},
  ) {
    this.baseDelay = opts.baseDelayMs ?? 500;
    this.maxDelay = opts.maxDelayMs ?? 10_000;
    this.requestTimeout = opts.requestTimeoutMs ?? 10_000;
    this.WS = opts.WebSocketImpl ?? WebSocket;
  }

  connect(): void {
    if (this.stopped) return;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.setStatus("open");
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
      const localNow = Date.now();
      let parsed: ServerMessage;
      try {
        const res = ServerMessageSchema.safeParse(JSON.parse(String(ev.data)));
        if (!res.success) {
          console.warn("dropping message that fails the protocol schema", res.error.issues);
          return;
        }
        parsed = res.data;
      } catch {
        return;
      }
      if (parsed.replyTo) {
        const p = this.pending.get(parsed.replyTo);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(parsed.replyTo);
          p.resolve(parsed);
        }
      }
      this.handlers.onMessage(parsed, localNow);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.failPending(new Error("socket closed"));
      if (this.stopped || NO_RETRY_CODES.has(ev.code)) {
        this.setStatus("closed");
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here.
    };
  }

  /** Close for good (page leaving). No reconnect. */
  close(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "bye");
    this.failPending(new Error("socket closed"));
    this.setStatus("closed");
  }

  /** Drop the current socket as if the network died; the backoff reconnect kicks in. */
  simulateDrop(): void {
    this.ws?.close();
  }

  /** Send a client message; resolves with the first server message carrying replyTo = id. */
  request<T extends ClientMessageType>(type: T, payload: ClientPayload<T>): Promise<ServerMessage> {
    const ws = this.ws;
    if (!ws || ws.readyState !== this.WS.OPEN) {
      return Promise.reject(new Error("not connected"));
    }
    const id = crypto.randomUUID();
    const frame = JSON.stringify({ type, id, ts: Date.now(), payload });
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for reply to ${type}`));
      }, this.requestTimeout);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(frame);
    });
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    const delay = reconnectDelay(this.attempt, this.baseDelay, this.maxDelay, Math.random());
    this.setStatus("reconnecting");
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private setStatus(s: SocketStatus): void {
    this.status = s;
    this.handlers.onStatus(s, this.attempt);
  }
}

/** Exponential backoff with up to 25% jitter: base * 2^(attempt-1), capped. */
export function reconnectDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: number,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (1 + 0.25 * random));
}

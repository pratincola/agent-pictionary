import { once } from "node:events";
import {
  type ClientMessage,
  type CreateAgentResponse,
  type CreateRoomResponse,
  type CreateSessionResponse,
  type PictionaryConfigInput,
  type ServerMessage,
  type ServerMessageOf,
  ServerMessage as ServerMessageSchema,
  type ServerMessageType,
} from "@pictionary/protocol";
import { sql } from "drizzle-orm";
import WebSocket from "ws";
import { type ArenaServer, buildServer } from "../src/app.js";

export const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/pictionary_test";

export async function startServer(
  overrides: Partial<Parameters<typeof buildServer>[0]> = {},
): Promise<ArenaServer> {
  const server = await buildServer({
    databaseUrl: TEST_DB_URL,
    host: "127.0.0.1",
    port: 0,
    logLevel: (process.env.TEST_LOG_LEVEL as "info" | undefined) ?? "silent",
    validateOutgoing: true,
    sessionSecret: "test-secret-test-secret-test-secret",
    adminToken: "test-admin-token",
    outboxRetryMs: 500,
    ...overrides,
  });
  await server.listen();
  return server;
}

export async function resetDb(server: ArenaServer): Promise<void> {
  await server.db.execute(sql`
    TRUNCATE TABLE outbox, entitlement_grants, agent_stats, scores, draw_ops, guesses, rounds, matches,
      sessions, rooms, agents, humans RESTART IDENTITY CASCADE
  `);
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

export async function api<T>(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

export async function registerAgent(base: string, name: string, humanHandle = `${name}-human`) {
  const r = await api<CreateAgentResponse>(base, "POST", "/agents", { name, humanHandle });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

export async function createRoom(
  base: string,
  apiKey?: string,
  config: PictionaryConfigInput = {},
) {
  const r = await api<CreateRoomResponse>(
    base,
    "POST",
    "/rooms",
    { gameId: "pictionary", config },
    apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  );
  if (r.status !== 201) throw new Error(`create room failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

export async function createSession(
  base: string,
  code: string,
  role: "agent" | "human" | "spectator",
  opts: { apiKey?: string; pairCode?: string } = {},
) {
  const r = await api<CreateSessionResponse>(
    base,
    "POST",
    `/rooms/${code}/sessions`,
    { role, ...(opts.pairCode ? { pairCode: opts.pairCode } : {}) },
    opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
  );
  if (r.status !== 201)
    throw new Error(`create session failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// ---------------------------------------------------------------------------
// WebSocket client
// ---------------------------------------------------------------------------

export class WsClient {
  readonly messages: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];
  private counter = 0;
  readonly ws: WebSocket;
  closed: Promise<{ code: number; reason: string }>;

  constructor(
    readonly url: string,
    readonly label = "client",
  ) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (data) => {
      const msg = ServerMessageSchema.parse(JSON.parse(data.toString()));
      this.messages.push(msg);
      const still: typeof this.waiters = [];
      for (const w of this.waiters) {
        if (w.pred(msg)) w.resolve(msg);
        else still.push(w);
      }
      this.waiters = still;
    });
    this.closed = new Promise((resolve) => {
      this.ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    this.ws.on("error", () => {});
  }

  static async connect(url: string, label?: string): Promise<WsClient> {
    const c = new WsClient(url, label);
    await once(c.ws, "open");
    return c;
  }

  /** Raw send; resolves when flushed to the kernel. */
  sendRaw(text: string): Promise<void> {
    return new Promise((resolve, reject) =>
      this.ws.send(text, (err) => (err ? reject(err) : resolve())),
    );
  }

  nextId(): string {
    return `${this.label}-${++this.counter}`;
  }

  /** Send a client message and resolve with the first reply carrying replyTo = id. */
  async request<T extends ClientMessage["type"]>(
    type: T,
    payload: Extract<ClientMessage, { type: T }>["payload"],
    opts: { id?: string; timeoutMs?: number } = {},
  ): Promise<ServerMessage> {
    const id = opts.id ?? this.nextId();
    const reply = this.waitFor(
      (m) => m.replyTo === id,
      opts.timeoutMs ?? 10_000,
      `reply to ${type}#${id}`,
    );
    await this.sendRaw(JSON.stringify({ type, id, ts: Date.now(), payload }));
    return reply;
  }

  /** Fire without waiting. Returns the id used. */
  fire<T extends ClientMessage["type"]>(
    type: T,
    payload: Extract<ClientMessage, { type: T }>["payload"],
    id = this.nextId(),
  ) {
    return { id, sent: this.sendRaw(JSON.stringify({ type, id, ts: Date.now(), payload })) };
  }

  /** Current position in the inbox; pass to waitFor/next to ignore older messages. */
  mark(): number {
    return this.messages.length;
  }

  /** Wait for the first message (already received or future) matching pred, at index >= from. */
  waitFor(
    pred: (m: ServerMessage) => boolean,
    timeoutMs = 10_000,
    what = "message",
    from = 0,
  ): Promise<ServerMessage> {
    const existing = this.messages.slice(from).find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        reject(
          new Error(
            `[${this.label}] timeout waiting for ${what}; got ${this.messages.map((m) => m.type).join(",")}`,
          ),
        );
      }, timeoutMs);
      const wrapped = (m: ServerMessage) => {
        clearTimeout(timer);
        resolve(m);
      };
      this.waiters.push({ pred, resolve: wrapped });
    });
  }

  /** Wait for the first message of a type at index >= from (default: from now on). */
  async next<T extends ServerMessageType>(
    type: T,
    from = this.messages.length,
    timeoutMs = 10_000,
  ): Promise<ServerMessageOf<T>> {
    const m = await this.waitFor((x) => x.type === type, timeoutMs, type, from);
    return m as ServerMessageOf<T>;
  }

  /** Wait for a message of this type whether it arrived before or after now. */
  async any<T extends ServerMessageType>(type: T, timeoutMs = 10_000): Promise<ServerMessageOf<T>> {
    return (await this.waitFor((x) => x.type === type, timeoutMs, type)) as ServerMessageOf<T>;
  }

  all<T extends ServerMessageType>(type: T): ServerMessageOf<T>[] {
    return this.messages.filter((m) => m.type === type) as ServerMessageOf<T>[];
  }

  last<T extends ServerMessageType>(type: T): ServerMessageOf<T> | undefined {
    return this.all(type).at(-1);
  }

  close(): Promise<{ code: number; reason: string }> {
    this.ws.close();
    return this.closed;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Scenario builders
// ---------------------------------------------------------------------------

export interface Player {
  name: string;
  agentId: string;
  apiKey: string;
  pairCode: string;
  session: CreateSessionResponse;
  ws: WsClient;
}

/** Register N agents, create a room (creator = first agent), connect all sockets. */
export async function setupRoom(base: string, n: number, config: PictionaryConfigInput = {}) {
  const regs = await Promise.all(
    Array.from({ length: n }, (_, i) => registerAgent(base, `agent${i}`)),
  );
  const first = regs[0] as CreateAgentResponse;
  const room = await createRoom(base, first.apiKey, config);
  const players: Player[] = [];
  for (const [i, reg] of regs.entries()) {
    const session = await createSession(base, room.code, "agent", { apiKey: reg.apiKey });
    const ws = await WsClient.connect(session.wsUrl, `agent${i}`);
    await ws.any("room.state");
    players.push({
      name: `agent${i}`,
      agentId: reg.agentId,
      apiKey: reg.apiKey,
      pairCode: reg.humanPairCode,
      session,
      ws,
    });
  }
  return { room, players };
}

/** Ready everyone, wait for choosing, drawer picks option 0, wait for drawing. */
export async function startAndChoose(players: Player[]) {
  await Promise.all(players.map((p) => p.ws.request("room.ready", {})));
  const choosing = await (players[0] as Player).ws.any("round.choosing");
  const drawer = players.find((p) => p.agentId === choosing.payload.drawerAgentId) as Player;
  await drawer.ws.any("round.wordOptions");
  await drawer.ws.request("word.choose", { index: 0 });
  await Promise.all(players.map((p) => p.ws.any("round.started")));
  const guessers = players.filter((p) => p !== drawer);
  return { drawer, guessers };
}

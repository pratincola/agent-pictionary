/**
 * Load worker thread: runs N rooms, each with one drawer, A-1 guessers and S
 * spectators on raw `ws` sockets. Measures, on every socket, the broadcast
 * latency of each draw.op (server `ts` -> client receipt) and checks opSeq
 * contiguity. Reports a bucketed histogram back to the orchestrator so a
 * million samples cost a few hundred KB, not a few hundred MB.
 */
import { parentPort, workerData } from "node:worker_threads";
import type { DrawOp, PictionaryConfigInput } from "@pictionary/protocol";
import { createRoom, createSession, registerAgent } from "@pictionary/sdk";
import WebSocket from "ws";

export interface WorkerInput {
  baseUrl: string;
  workerIndex: number;
  rooms: number;
  agentsPerRoom: number;
  spectatorsPerRoom: number;
  opsPerSecond: number;
  durationMs: number;
  /** Round length requested from the server; must exceed durationMs. */
  drawSeconds: number;
}

/** Latency histogram: 0.1 ms buckets up to 5 s; the last bucket is overflow. */
export const BUCKET_MS = 0.1;
export const BUCKETS = 50_001;

export interface RoomStats {
  code: string;
  sockets: number;
  /** Messages received on every socket, any type. */
  messagesIn: number;
  /** draw.op broadcasts received, summed over sockets. */
  drawOpsIn: number;
  opsSent: number;
  /** Sockets whose opSeq sequence was 1..N with no gap and no duplicate. */
  contiguousSockets: number;
  /** Sockets that ended with fewer ops than the drawer sent (delivery incomplete at close). */
  shortSockets: number;
  gaps: number;
  guesses: number;
  errors: string[];
  /** Wall time from first socket open to last socket close. */
  wallMs: number;
}

export interface WorkerOutput {
  workerIndex: number;
  rooms: RoomStats[];
  histogram: Uint32Array;
}

interface SocketStats {
  messagesIn: number;
  drawOpsIn: number;
  lastOpSeq: number;
  gaps: number;
}

const input = workerData as WorkerInput;
const histogram = new Uint32Array(BUCKETS);

function observe(ms: number): void {
  const i = Math.min(BUCKETS - 1, Math.max(0, Math.round(ms / BUCKET_MS)));
  histogram[i] = (histogram[i] ?? 0) + 1;
}

/** Wall clock with sub-ms resolution, comparable to the server's Date.now() `ts`. */
function now(): number {
  return performance.timeOrigin + performance.now();
}

/** Create a socket, let `setup` add listeners synchronously (room.state may arrive in the open tick), resolve on open. */
function open(url: string, setup: (ws: WebSocket) => void): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    setup(ws);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitFor(
  ws: WebSocket,
  type: string,
  timeoutMs = 30_000,
  errors?: string[],
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`timeout waiting for ${type}; errors: ${(errors ?? []).join(" | ")}`));
    }, timeoutMs);
    timer.unref();
    function onMessage(data: WebSocket.RawData) {
      const m = JSON.parse(data.toString()) as Record<string, unknown>;
      if (m.type === type) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(m);
      }
    }
    ws.on("message", onMessage);
  });
}

function send(ws: WebSocket, type: string, payload: unknown, id = `${type}-${Math.random()}`) {
  ws.send(JSON.stringify({ type, id, ts: Date.now(), payload }));
}

/** Small path op; 6 points keeps the frame ~150 bytes like a real stroke segment. */
function nextOp(i: number): DrawOp {
  const x = (i * 37) % 900;
  const y = (i * 53) % 900;
  return {
    kind: "path",
    width: 2,
    color: "#1f2937",
    points: [
      [x, y],
      [x + 5, y + 7],
      [x + 12, y + 9],
      [x + 20, y + 15],
      [x + 25, y + 24],
      [x + 31, y + 30],
    ],
  };
}

async function runRoom(roomIndex: number): Promise<RoomStats> {
  const label = `w${input.workerIndex}r${roomIndex}`;
  const errors: string[] = [];
  const t0 = now();
  const regs = await Promise.all(
    Array.from({ length: input.agentsPerRoom }, (_, i) =>
      registerAgent(input.baseUrl, { name: `${label}-a${i}`, humanHandle: "load" }),
    ),
  );
  const creator = regs[0] as (typeof regs)[number];
  const config: PictionaryConfigInput = {
    roundsPerPlayer: 1,
    chooseSeconds: 30,
    drawSeconds: input.drawSeconds,
    revealSeconds: 2,
    minPlayers: input.agentsPerRoom,
    maxPlayers: input.agentsPerRoom,
  };
  const room = await createRoom(input.baseUrl, { apiKey: creator.apiKey }, config);

  const agentSessions = await Promise.all(
    regs.map((r) => createSession(input.baseUrl, room.code, "agent", { apiKey: r.apiKey })),
  );
  const spectatorSessions: { wsUrl: string }[] = [];
  for (let i = 0; i < input.spectatorsPerRoom; i += 25) {
    const n = Math.min(25, input.spectatorsPerRoom - i);
    spectatorSessions.push(
      ...(await Promise.all(
        Array.from({ length: n }, () => createSession(input.baseUrl, room.code, "spectator")),
      )),
    );
  }

  const stats = new Map<WebSocket, SocketStats>();
  const sockets: WebSocket[] = [];
  const stateWaits: Promise<unknown>[] = [];
  const attach = (ws: WebSocket) => {
    const s: SocketStats = { messagesIn: 0, drawOpsIn: 0, lastOpSeq: 0, gaps: 0 };
    stats.set(ws, s);
    sockets.push(ws);
    stateWaits.push(waitFor(ws, "room.state", 15_000));
    ws.on("message", (data) => {
      const received = now();
      s.messagesIn++;
      // Cheap type sniff before the full parse: draw.op is the hot path.
      const text = data.toString();
      if (text.startsWith('{"type":"error"')) errors.push(`${label}: ${text.slice(0, 200)}`);
      if (!text.startsWith('{"type":"draw.op"')) return;
      const m = JSON.parse(text) as { ts: number; payload: { opSeq: number } };
      s.drawOpsIn++;
      observe(received - m.ts);
      const seq = m.payload.opSeq;
      if (seq !== s.lastOpSeq + 1) s.gaps++;
      if (seq > s.lastOpSeq) s.lastOpSeq = seq;
    });
    ws.on("error", (err) => errors.push(`${label}: ${err.message}`));
  };

  // Agents join one at a time (join order = drawer rotation); spectators in parallel.
  const agentSockets: WebSocket[] = [];
  for (const sess of agentSessions) {
    const ws = await open(sess.wsUrl, attach);
    await stateWaits[stateWaits.length - 1];
    agentSockets.push(ws);
  }
  await Promise.all(spectatorSessions.map((sess) => open(sess.wsUrl, attach)));
  await Promise.all(stateWaits);

  // round.choosing and round.wordOptions land in the same step: arm every
  // waiter before the first room.ready goes out.
  const choosing = waitFor(agentSockets[0] as WebSocket, "round.choosing", 30_000, errors);
  const optionWaits = agentSockets.map((ws) =>
    waitFor(ws, "round.wordOptions", 30_000, errors).catch(() => null),
  );
  for (const ws of agentSockets) send(ws, "room.ready", {});
  const drawerAgentId = (await choosing).payload as { drawerAgentId: string };
  const drawerIndex = regs.findIndex((r) => r.agentId === drawerAgentId.drawerAgentId);
  const drawer = agentSockets[drawerIndex] as WebSocket;
  const guessers = agentSockets.filter((_, i) => i !== drawerIndex);
  if (!(await optionWaits[drawerIndex])) throw new Error(`${label}: drawer got no word options`);
  const started = waitFor(drawer, "round.started", 30_000, errors);
  send(drawer, "word.choose", { index: 0 });
  await started;

  // Guessers: 2 wrong guesses each at random times. The third stays unused so
  // the round never ends `exhausted` before the drawer is done.
  let guesses = 0;
  const guessTimers: NodeJS.Timeout[] = [];
  for (const g of guessers) {
    for (let k = 0; k < 2; k++) {
      const at = Math.random() * input.durationMs;
      guessTimers.push(
        setTimeout(() => {
          send(g, "guess.submit", { text: `zzz nope ${Math.floor(Math.random() * 1e6)}` });
          guesses++;
        }, at),
      );
    }
  }

  // Drawer: one op per message at the configured rate for durationMs.
  let opsSent = 0;
  const interval = 1000 / input.opsPerSecond;
  const drawStart = now();
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (now() - drawStart >= input.durationMs) {
        clearInterval(timer);
        resolve();
        return;
      }
      send(drawer, "draw.ops", { ops: [nextOp(opsSent)] });
      opsSent++;
    }, interval);
  });
  for (const t of guessTimers) clearTimeout(t);

  // Let in-flight broadcasts land (bounded), then audit every socket.
  const settleUntil = now() + 3_000;
  while (now() < settleUntil) {
    let done = true;
    for (const s of stats.values()) if (s.lastOpSeq < opsSent) done = false;
    if (done) break;
    await new Promise((r) => setTimeout(r, 25));
  }

  let messagesIn = 0;
  let drawOpsIn = 0;
  let gaps = 0;
  let contiguous = 0;
  let short = 0;
  for (const s of stats.values()) {
    messagesIn += s.messagesIn;
    drawOpsIn += s.drawOpsIn;
    gaps += s.gaps;
    if (s.gaps === 0 && s.drawOpsIn === opsSent && s.lastOpSeq === opsSent) contiguous++;
    if (s.lastOpSeq < opsSent) short++;
  }
  await Promise.all(
    sockets.map(
      (ws) =>
        new Promise<void>((resolve) => {
          ws.once("close", () => resolve());
          ws.close();
        }),
    ),
  );
  return {
    code: room.code,
    sockets: sockets.length,
    messagesIn,
    drawOpsIn,
    opsSent,
    contiguousSockets: contiguous,
    shortSockets: short,
    gaps,
    guesses,
    errors,
    wallMs: now() - t0,
  };
}

async function main(): Promise<void> {
  const rooms = await Promise.all(Array.from({ length: input.rooms }, (_, i) => runRoom(i)));
  const out: WorkerOutput = { workerIndex: input.workerIndex, rooms, histogram };
  parentPort?.postMessage(out, [histogram.buffer]);
}

main().catch((err: unknown) => {
  parentPort?.postMessage({
    error: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });
});

/**
 * load: PLAN.md §14.5. R rooms x A agents + S spectators per room; the drawer
 * sends ops at a fixed rate for D seconds; guessers guess wrong at random.
 * Clients run in worker threads so the measuring side never starves. The
 * server runs in its own process (spawned here or already running) and is
 * sampled through GET /metrics for CPU, RSS, message counters and the
 * server-side broadcast-latency histogram.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { sleep } from "../util.js";
import {
  BUCKET_MS,
  BUCKETS,
  type RoomStats,
  type WorkerInput,
  type WorkerOutput,
} from "./worker.js";

export interface LoadOptions {
  /** Existing server. When unset, one is spawned from apps/server/dist/main.js. */
  baseUrl?: string;
  port: number;
  databaseUrl: string;
  rooms: number;
  agentsPerRoom: number;
  spectatorsPerRoom: number;
  opsPerSecond: number;
  durationSec: number;
  workers: number;
  /** Write the JSON report here when set. */
  jsonOut?: string;
  log?: (line: string) => void;
}

export interface Quantiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
}

export interface LoadReport {
  startedAt: string;
  options: Omit<LoadOptions, "log">;
  hardware: { cpus: number; model: string; node: string; platform: string; totalMemMb: number };
  rooms: RoomStats[];
  /** Client-measured: server `ts` -> client receipt, ms. */
  clientLatencyMs: Quantiles;
  /** Server-measured from /metrics: socket receipt (recvNs) -> fan-out loop done, ms (bucket upper bounds). */
  serverBroadcastLatencyMs: Quantiles | null;
  /** Server event-loop lag p99 at the end of the run, ms (nodejs_eventloop_lag_p99_seconds). */
  serverEventLoopLagP99Ms: number | null;
  wsMessagesPerSecond: { in: number; out: number; clientObserved: number };
  server: {
    cpuPercentOfOneCore: number;
    rssStartMb: number;
    rssEndMb: number;
    rssPeakMb: number;
    actorQueueDepthMax: number;
  };
  totals: {
    sockets: number;
    opsSent: number;
    drawOpsReceived: number;
    expectedDrawOps: number;
    contiguousSockets: number;
    shortSockets: number;
    gaps: number;
    guesses: number;
    errors: string[];
  };
  passed: { p95Under50ms: boolean; allContiguous: boolean };
  wallSec: number;
}

interface MetricsSample {
  at: number;
  cpuSeconds: number;
  rssBytes: number;
  wsIn: number;
  wsOut: number;
  queueDepth: number;
  eventLoopP99: number | null;
  /** cumulative counts by `le` upper bound (seconds). */
  broadcastBuckets: { le: number; count: number }[];
}

export async function runLoad(opts: LoadOptions): Promise<LoadReport> {
  const out = opts.log ?? ((l: string) => console.log(l));
  const startedAt = new Date();
  let child: ChildProcess | undefined;
  let baseUrl = opts.baseUrl;
  if (!baseUrl) {
    baseUrl = `http://127.0.0.1:${opts.port}`;
    child = spawnServer(opts, out);
    await waitHealthy(baseUrl, 30_000);
  }
  try {
    const os = await import("node:os");
    const hardware = {
      cpus: os.cpus().length,
      model: os.cpus()[0]?.model ?? "unknown",
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      totalMemMb: Math.round(os.totalmem() / 1048576),
    };
    out(
      `load: ${opts.rooms} rooms x (${opts.agentsPerRoom} agents + ${opts.spectatorsPerRoom} spectators), ` +
        `drawer ${opts.opsPerSecond} ops/s for ${opts.durationSec}s, ${opts.workers} client workers -> ${baseUrl}`,
    );
    const before = await scrape(baseUrl);
    const samples: MetricsSample[] = [before];
    const sampler = setInterval(() => {
      void scrape(baseUrl as string)
        .then((s) => samples.push(s))
        .catch(() => {});
    }, 2_000);

    const t0 = performance.now();
    const results = await runWorkers(baseUrl, opts, out);
    const wallSec = (performance.now() - t0) / 1000;
    clearInterval(sampler);
    const after = await scrape(baseUrl);
    samples.push(after);

    const histogram = new Uint32Array(BUCKETS);
    const rooms: RoomStats[] = [];
    for (const r of results) {
      for (let i = 0; i < BUCKETS; i++) histogram[i] = (histogram[i] ?? 0) + (r.histogram[i] ?? 0);
      rooms.push(...r.rooms);
    }
    const totals = {
      sockets: sum(rooms, (r) => r.sockets),
      opsSent: sum(rooms, (r) => r.opsSent),
      drawOpsReceived: sum(rooms, (r) => r.drawOpsIn),
      expectedDrawOps: sum(rooms, (r) => r.opsSent * r.sockets),
      contiguousSockets: sum(rooms, (r) => r.contiguousSockets),
      shortSockets: sum(rooms, (r) => r.shortSockets),
      gaps: sum(rooms, (r) => r.gaps),
      guesses: sum(rooms, (r) => r.guesses),
      errors: rooms.flatMap((r) => r.errors),
    };
    const clientLatencyMs = quantilesFromHistogram(histogram);
    const elapsed = (after.at - before.at) / 1000;
    const report: LoadReport = {
      startedAt: startedAt.toISOString(),
      options: stripLog(opts),
      hardware,
      rooms,
      clientLatencyMs,
      serverBroadcastLatencyMs: quantilesFromProm(before, after),
      serverEventLoopLagP99Ms: after.eventLoopP99 === null ? null : after.eventLoopP99 * 1000,
      wsMessagesPerSecond: {
        in: round((after.wsIn - before.wsIn) / elapsed),
        out: round((after.wsOut - before.wsOut) / elapsed),
        clientObserved: round(sum(rooms, (r) => r.messagesIn) / wallSec),
      },
      server: {
        cpuPercentOfOneCore: round(((after.cpuSeconds - before.cpuSeconds) / elapsed) * 100),
        rssStartMb: round(before.rssBytes / 1048576),
        rssEndMb: round(after.rssBytes / 1048576),
        rssPeakMb: round(Math.max(...samples.map((s) => s.rssBytes)) / 1048576),
        actorQueueDepthMax: Math.max(...samples.map((s) => s.queueDepth)),
      },
      totals,
      passed: {
        p95Under50ms: clientLatencyMs.p95 < 50,
        allContiguous: totals.contiguousSockets === totals.sockets && totals.gaps === 0,
      },
      wallSec: round(wallSec),
    };
    printReport(report, out);
    if (opts.jsonOut) await writeFile(opts.jsonOut, JSON.stringify(report, null, 2));
    return report;
  } finally {
    if (child) await stopServer(child);
  }
}

function spawnServer(opts: LoadOptions, out: (l: string) => void): ChildProcess {
  const main = new URL("../../../server/dist/main.js", import.meta.url);
  out(`spawning server ${main.pathname} on :${opts.port}`);
  const child = spawn(process.execPath, [main.pathname], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(opts.port),
      DATABASE_URL: opts.databaseUrl,
      LOG_LEVEL: process.env.LOAD_SERVER_LOG ?? "warn",
      NODE_ID: "load-node",
      // The whole load comes from one IP.
      RATE_LIMIT_AGENTS_PER_MIN: "100000",
      RATE_LIMIT_ROOMS_PER_MIN: "100000",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) out(`server exited with code ${code} ${signal ?? ""}`);
  });
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 20_000).unref();
  });
}

async function waitHealthy(baseUrl: string, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${baseUrl}/readyz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`server at ${baseUrl} did not become ready in ${timeoutMs} ms`);
}

async function runWorkers(
  baseUrl: string,
  opts: LoadOptions,
  out: (l: string) => void,
): Promise<WorkerOutput[]> {
  const workers = Math.min(opts.workers, opts.rooms);
  const perWorker = Array.from(
    { length: workers },
    (_, i) => Math.floor(opts.rooms / workers) + (i < opts.rooms % workers ? 1 : 0),
  );
  const url = new URL("./worker.js", import.meta.url);
  const runs = perWorker.map(
    (rooms, workerIndex) =>
      new Promise<WorkerOutput>((resolve, reject) => {
        const workerData: WorkerInput = {
          baseUrl,
          workerIndex,
          rooms,
          agentsPerRoom: opts.agentsPerRoom,
          spectatorsPerRoom: opts.spectatorsPerRoom,
          opsPerSecond: opts.opsPerSecond,
          durationMs: opts.durationSec * 1000,
          drawSeconds: Math.min(300, opts.durationSec + 30),
        };
        const w = new Worker(url, { workerData });
        w.on("message", (m: WorkerOutput | { error: string }) => {
          if ("error" in m) reject(new Error(`worker ${workerIndex}: ${m.error}`));
          else {
            out(`worker ${workerIndex}: ${m.rooms.length} rooms done`);
            resolve(m);
          }
        });
        w.on("error", reject);
        w.on("exit", (code) => {
          if (code !== 0) reject(new Error(`worker ${workerIndex} exited with ${code}`));
        });
      }),
  );
  return Promise.all(runs);
}

async function scrape(baseUrl: string): Promise<MetricsSample> {
  const text = await (await fetch(`${baseUrl}/metrics`)).text();
  const num = (re: RegExp): number | null => {
    const m = re.exec(text);
    return m ? Number(m[1]) : null;
  };
  const buckets: { le: number; count: number }[] = [];
  for (const m of text.matchAll(
    /ap_broadcast_latency_seconds_bucket\{[^}]*le="([^"]+)"[^}]*\} (\d+)/g,
  )) {
    buckets.push({
      le: m[1] === "+Inf" ? Number.POSITIVE_INFINITY : Number(m[1]),
      count: Number(m[2]),
    });
  }
  return {
    at: Date.now(),
    cpuSeconds: num(/process_cpu_seconds_total(?:\{[^}]*\})? ([\d.e+-]+)/) ?? 0,
    rssBytes: num(/process_resident_memory_bytes(?:\{[^}]*\})? ([\d.e+-]+)/) ?? 0,
    wsIn: num(/ap_ws_messages_total\{[^}]*direction="in"[^}]*\} ([\d.e+-]+)/) ?? 0,
    wsOut: num(/ap_ws_messages_total\{[^}]*direction="out"[^}]*\} ([\d.e+-]+)/) ?? 0,
    queueDepth: num(/ap_actor_queue_depth(?:\{[^}]*\})? ([\d.e+-]+)/) ?? 0,
    eventLoopP99: num(/nodejs_eventloop_lag_p99_seconds(?:\{[^}]*\})? ([\d.e+-]+)/),
    broadcastBuckets: buckets.sort((a, b) => a.le - b.le),
  };
}

function quantilesFromHistogram(h: Uint32Array): Quantiles {
  let count = 0;
  let max = 0;
  for (let i = 0; i < h.length; i++) {
    const c = h[i] ?? 0;
    if (c > 0) {
      count += c;
      max = i;
    }
  }
  const q = (p: number): number => {
    if (count === 0) return 0;
    const target = Math.ceil(count * p);
    let acc = 0;
    for (let i = 0; i < h.length; i++) {
      acc += h[i] ?? 0;
      if (acc >= target) return round(i * BUCKET_MS, 1);
    }
    return round(max * BUCKET_MS, 1);
  };
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: round(max * BUCKET_MS, 1), count };
}

/** Quantiles of the server histogram over the run (delta of cumulative buckets). Upper bounds in ms. */
function quantilesFromProm(before: MetricsSample, after: MetricsSample): Quantiles | null {
  if (after.broadcastBuckets.length === 0) return null;
  const delta = after.broadcastBuckets.map((b, i) => ({
    le: b.le,
    count: b.count - (before.broadcastBuckets[i]?.count ?? 0),
  }));
  const total = delta.at(-1)?.count ?? 0;
  if (total === 0) return null;
  const q = (p: number): number => {
    const target = Math.ceil(total * p);
    for (const b of delta) if (b.count >= target) return b.le * 1000;
    return Number.POSITIVE_INFINITY;
  };
  const finite = delta.filter((b) => Number.isFinite(b.le));
  const maxBucket = finite.find((b) => b.count === total);
  return {
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: maxBucket ? maxBucket.le * 1000 : Number.POSITIVE_INFINITY,
    count: total,
  };
}

function printReport(r: LoadReport, out: (l: string) => void): void {
  const c = r.clientLatencyMs;
  const s = r.serverBroadcastLatencyMs;
  out("");
  out("=== load report ===");
  out(
    `hardware: ${r.hardware.cpus} cpu (${r.hardware.model}), ${r.hardware.totalMemMb} MB, node ${r.hardware.node}, ${r.hardware.platform}`,
  );
  out(
    `rooms ${r.rooms.length}, sockets ${r.totals.sockets}, ops sent ${r.totals.opsSent}, guesses ${r.totals.guesses}, wall ${r.wallSec}s`,
  );
  out(
    `client broadcast latency (server ts -> receipt): p50 ${c.p50} ms, p95 ${c.p95} ms, p99 ${c.p99} ms, max ${c.max} ms (n=${c.count})`,
  );
  if (s)
    out(
      `server recvNs -> fan-out (bucket upper bounds): p50 <= ${s.p50} ms, p95 <= ${s.p95} ms, p99 <= ${s.p99} ms (n=${s.count})`,
    );
  out(
    `ws messages/s: server in ${r.wsMessagesPerSecond.in}, server out ${r.wsMessagesPerSecond.out}, client observed ${r.wsMessagesPerSecond.clientObserved}`,
  );
  out(
    `server: cpu ${r.server.cpuPercentOfOneCore}% of one core, rss ${r.server.rssStartMb} -> ${r.server.rssEndMb} MB (peak ${r.server.rssPeakMb}), actor queue depth max ${r.server.actorQueueDepthMax}` +
      (r.serverEventLoopLagP99Ms === null
        ? ""
        : `, event-loop lag p99 ${round(r.serverEventLoopLagP99Ms)} ms`),
  );
  out(
    `opSeq contiguity: ${r.totals.contiguousSockets}/${r.totals.sockets} sockets contiguous, gaps ${r.totals.gaps}, short ${r.totals.shortSockets}, draw.op received ${r.totals.drawOpsReceived}/${r.totals.expectedDrawOps}`,
  );
  if (r.totals.errors.length > 0)
    out(`errors (${r.totals.errors.length}): ${r.totals.errors.slice(0, 5).join(" | ")}`);
  out(
    `target p95 < 50 ms: ${r.passed.p95Under50ms ? "PASS" : "FAIL"}; all sockets contiguous: ${r.passed.allContiguous ? "PASS" : "FAIL"}`,
  );
}

function sum<T>(items: T[], f: (t: T) => number): number {
  let n = 0;
  for (const i of items) n += f(i);
  return n;
}

function round(n: number, digits = 1): number {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

function stripLog(o: LoadOptions): Omit<LoadOptions, "log"> {
  const { log: _log, ...rest } = o;
  return rest;
}

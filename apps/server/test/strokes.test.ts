/**
 * Stroke integrity (PLAN.md §14.4): 2,000 ops at the 30 ops/s limit. Every
 * client sees contiguous opSeq 1..2000; a client that reconnects mid-stream
 * fills the gap with GET /ops?after= and ends with the same log.
 */
import {
  type DrawOp,
  MAX_OPS_PER_SECOND,
  type OpLogEntry,
  type OpsResponse,
  type ServerMessageOf,
} from "@pictionary/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArenaServer } from "../src/app.js";
import {
  api,
  createSession,
  type Player,
  resetDb,
  setupRoom,
  sleep,
  startAndChoose,
  startServer,
  WsClient,
} from "./helpers.js";

const TOTAL_OPS = 2000;
const PER_MESSAGE = 20;

let server: ArenaServer;

beforeAll(async () => {
  server = await startServer();
  await resetDb(server);
});
afterAll(async () => {
  await server.close();
});

function op(i: number): DrawOp {
  const x = i % 1000;
  return { kind: "line", from: [x, 0], to: [1000 - x, 1000], width: 2, color: "#0000ff" };
}

function opSeqs(ws: WsClient): number[] {
  return ws.all("draw.op").map((m) => m.payload.opSeq);
}

function contiguous(seqs: number[], n: number): boolean {
  if (seqs.length !== n) return false;
  for (let i = 0; i < n; i++) if (seqs[i] !== i + 1) return false;
  return true;
}

describe("stroke integrity", () => {
  it("rejects a burst above the limit with RATE_LIMITED and keeps the socket open", async () => {
    const { players } = await setupRoom(server.baseUrl, 2, { drawSeconds: 120 });
    const { drawer } = await startAndChoose(players);
    const ops = Array.from({ length: PER_MESSAGE }, (_, i) => op(i));
    // Bucket holds 30 tokens: 20 pass, the next 20 do not.
    const first = await drawer.ws.request("draw.ops", { ops });
    expect(first.type).toBe("ack");
    const second = await drawer.ws.request("draw.ops", { ops });
    expect(second.type).toBe("error");
    expect((second.payload as { code: string }).code).toBe("RATE_LIMITED");
    const pong = await drawer.ws.request("ping", {});
    expect(pong.type).toBe("pong");
    await sleep(700);
    const third = await drawer.ws.request("draw.ops", { ops });
    expect(third.type).toBe("ack");
    expect(third.payload).toEqual({ opSeqFrom: 21, opSeqTo: 40 });
    await Promise.all(players.map((p) => p.ws.close()));
  });

  it(`${TOTAL_OPS} ops at ${MAX_OPS_PER_SECOND} ops/s reach every client contiguously; a reconnecting client fills its gap`, async () => {
    const { room, players } = await setupRoom(server.baseUrl, 3, {
      drawSeconds: 300,
      chooseSeconds: 60,
    });
    const spectatorSession = await createSession(server.baseUrl, room.code, "spectator");
    const spectator = await WsClient.connect(spectatorSession.wsUrl, "spectator");
    await spectator.any("room.state");
    const { drawer, guessers } = await startAndChoose(players);
    const [steady, flaky] = guessers as [Player, Player];

    // --- Drawer: 100 messages of 20 ops, one every 1000/30*20 ms (exactly the limit).
    const intervalMs = (PER_MESSAGE / MAX_OPS_PER_SECOND) * 1000;
    const acks: Promise<unknown>[] = [];
    const t0 = Date.now();
    const sendAll = (async () => {
      for (let m = 0; m < TOTAL_OPS / PER_MESSAGE; m++) {
        const due = t0 + m * intervalMs;
        const wait = due - Date.now();
        if (wait > 0) await sleep(wait);
        const ops = Array.from({ length: PER_MESSAGE }, (_, i) => op(m * PER_MESSAGE + i));
        acks.push(drawer.ws.request("draw.ops", { ops }, { timeoutMs: 30_000 }));
      }
      return Promise.all(acks);
    })();

    // --- Flaky guesser: drop the socket mid-stream, reconnect with the same token later.
    await flaky.ws.waitFor(
      (m) => m.type === "draw.op" && (m.payload as { opSeq: number }).opSeq >= 300,
      60_000,
      "opSeq 300",
    );
    const seenBefore = opSeqs(flaky.ws);
    const lastSeen = seenBefore[seenBefore.length - 1] as number;
    await flaky.ws.close();
    await sleep(intervalMs * 10); // miss ~200 ops
    const reconnected = await WsClient.connect(flaky.session.wsUrl, "flaky-2");
    const snapshot = await reconnected.any("room.state");
    expect(snapshot.payload.round?.phase).toBe("drawing");
    expect(snapshot.payload.round?.myGuessesRemaining).toBe(3);
    const snapshotOps = snapshot.payload.round?.ops ?? [];
    // The snapshot already carries the full log so far; the delta endpoint fills what the
    // client missed between its last seen op and the snapshot/stream.
    expect(snapshotOps.length).toBeGreaterThan(lastSeen);
    const gap = await api<OpsResponse>(
      server.baseUrl,
      "GET",
      `/rooms/${room.code}/ops?after=${lastSeen}`,
    );
    expect(gap.status).toBe(200);
    expect(gap.body.ops[0]?.opSeq).toBe(lastSeen + 1);

    // --- Wait for the drawer to finish and every client to see op 2000.
    const ackResults = (await sendAll) as ServerMessageOf<"ack">[];
    expect(ackResults.every((a) => a.type === "ack")).toBe(true);
    const ranges = ackResults.map((a) => [a.payload.opSeqFrom, a.payload.opSeqTo]);
    expect(ranges[0]).toEqual([1, PER_MESSAGE]);
    expect(ranges.at(-1)).toEqual([TOTAL_OPS - PER_MESSAGE + 1, TOTAL_OPS]);
    for (let i = 1; i < ranges.length; i++)
      expect(ranges[i]?.[0]).toBe((ranges[i - 1]?.[1] as number) + 1);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual((TOTAL_OPS / PER_MESSAGE - 1) * intervalMs * 0.98);

    const lastOp = (m: { type: string; payload: unknown }) =>
      m.type === "draw.op" && (m.payload as { opSeq: number }).opSeq === TOTAL_OPS;
    await Promise.all(
      [drawer.ws, steady.ws, spectator, reconnected].map((c) =>
        c.waitFor(lastOp, 30_000, "op 2000"),
      ),
    );

    // Steady clients saw 1..2000 in order, with no duplicates or gaps.
    for (const c of [drawer.ws, steady.ws, spectator])
      expect(contiguous(opSeqs(c), TOTAL_OPS)).toBe(true);

    // Flaky client: before-disconnect stream + gap fill + after-reconnect stream == same log.
    const merged = new Map<number, OpLogEntry>();
    for (const m of flaky.ws.all("draw.op"))
      merged.set(m.payload.opSeq, { opSeq: m.payload.opSeq, op: m.payload.op });
    for (const e of gap.body.ops) merged.set(e.opSeq, e);
    for (const e of snapshotOps) merged.set(e.opSeq, e);
    for (const m of reconnected.all("draw.op"))
      merged.set(m.payload.opSeq, { opSeq: m.payload.opSeq, op: m.payload.op });
    const mergedSeqs = [...merged.keys()].sort((a, b) => a - b);
    expect(contiguous(mergedSeqs, TOTAL_OPS)).toBe(true);
    const reference = steady.ws
      .all("draw.op")
      .map((m) => ({ opSeq: m.payload.opSeq, op: m.payload.op }));
    expect(mergedSeqs.map((s) => merged.get(s))).toEqual(reference);
    // And the authoritative log on the server matches too.
    const full = await api<OpsResponse>(server.baseUrl, "GET", `/rooms/${room.code}/ops?after=0`);
    expect(full.body.ops.map((e) => ({ opSeq: e.opSeq, op: e.op }))).toEqual(reference);

    await Promise.all([
      ...players.map((p) => p.ws.close()),
      spectator.close(),
      reconnected.close(),
    ]);
  }, 180_000);
});

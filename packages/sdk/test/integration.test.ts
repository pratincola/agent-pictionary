import type { DrawOp } from "@pictionary/protocol";
import type { ArenaServer } from "@pictionary/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AgentClient,
  createRoom,
  getOps,
  ProtocolError,
  registerAgent,
  setEntitlements,
} from "../src/index.js";
import { ADMIN_TOKEN, startTestServer } from "./server.js";

let server: ArenaServer;
let base: string;

beforeAll(async () => {
  server = await startTestServer();
  base = server.baseUrl;
});
afterAll(async () => {
  await server.close();
});

const line = (i: number): DrawOp => ({
  kind: "line",
  from: [i % 1000, 10],
  to: [(i * 7) % 1000, 990],
  width: 2,
  color: "#222222",
});

async function twoAgents(config: Record<string, unknown> = {}) {
  const a = await registerAgent(base, { name: "sdk-a", humanHandle: "ha" });
  const b = await registerAgent(base, { name: "sdk-b", humanHandle: "hb" });
  const room = await createRoom(
    base,
    { apiKey: a.apiKey },
    { chooseSeconds: 15, drawSeconds: 40, revealSeconds: 1, ...config },
  );
  const ca = new AgentClient({ baseUrl: base, apiKey: a.apiKey });
  const cb = new AgentClient({ baseUrl: base, apiKey: b.apiKey });
  const sa = await ca.connect(room.code);
  expect(sa.you.agentId).toBe(a.agentId);
  const joined = ca.waitFor("room.playerJoined", (m) => m.payload.agentId === b.agentId);
  await cb.connect(room.code);
  await joined;
  expect(ca.state?.players.map((p) => p.agentId).sort()).toEqual([a.agentId, b.agentId].sort());
  return { a, b, room, ca, cb };
}

/** Ready both, wait for choosing, drawer picks option 0. Returns drawer/guesser and the word. */
async function startRound(ca: AgentClient, cb: AgentClient) {
  const choosing = ca.waitFor("round.choosing");
  await Promise.all([ca.ready(), cb.ready()]);
  const ch = await choosing;
  const drawer = ch.payload.drawerAgentId === ca.agentId ? ca : cb;
  const guesser = drawer === ca ? cb : ca;
  expect(drawer.isDrawer()).toBe(true);
  expect(guesser.isDrawer()).toBe(false);
  // Options arrive in the same step as round.choosing; the reducer stored them.
  const options =
    drawer.state?.round?.options ?? (await drawer.waitFor("round.wordOptions")).payload.options;
  const started = Promise.all([guesser.waitFor("round.started"), drawer.waitFor("round.started")]);
  await drawer.chooseWord(0);
  const [rs] = await started;
  return { drawer, guesser, word: options[0]?.word as string, started: rs.payload };
}

describe("AgentClient against the real server", () => {
  it("two clients play a two-round match end to end", async () => {
    const { ca, cb } = await twoAgents();
    const r1 = await startRound(ca, cb);
    const { drawer, guesser, word } = r1;

    expect(drawer.word()).toBe(word);
    expect(guesser.word()).toBeUndefined();
    expect(guesser.state?.round?.wordPattern).toBe(r1.started.wordPattern);
    expect(guesser.guessesRemaining()).toBe(3);
    expect(drawer.guessesRemaining()).toBe(0);
    expect(drawer.secondsLeft()).toBeGreaterThan(30);

    // Drawer draws; guesser's state follows.
    const seen = guesser.waitFor("draw.op", (m) => m.payload.opSeq === 25);
    const res = await drawer.draw(Array.from({ length: 25 }, (_, i) => line(i)));
    expect(res.batches).toHaveLength(2);
    expect(res).toMatchObject({ opSeqFrom: 1, opSeqTo: 25 });
    await seen;
    expect(guesser.state?.round?.ops.map((e) => e.opSeq)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(drawer.lastOpSeq()).toBe(25);
    const png = guesser.renderPng({ size: 64 });
    expect(png.subarray(1, 4).toString()).toBe("PNG");

    // Wrong guess, then the right one.
    const wrong = await guesser.guess("definitely-not-the-word");
    expect(wrong).toEqual({ result: "incorrect", remaining: 2 });
    expect(guesser.guessesRemaining()).toBe(2);
    const drawerCount = await drawer.waitFor("guess.count", undefined, 2000).catch(() => undefined);
    if (drawerCount) expect(drawerCount.payload.wrongGuesses).toBe(1);

    // Drawer may not guess.
    await expect(drawer.guess(word)).rejects.toMatchObject({ code: "NOT_GUESSER" });

    const ended = guesser.waitFor("round.ended");
    const right = await guesser.guess(word.toUpperCase());
    expect(right.result).toBe("correct");
    const re = await ended;
    expect(re.payload.winner?.agentId).toBe(guesser.agentId);
    expect(re.payload.word).toBe(word);
    expect(guesser.state?.round?.phase).toBe("reveal");
    expect(guesser.word()).toBe(word);
    expect(guesser.state?.lastRoundEnded?.reason).toBe("guessed");
    expect(guesser.state?.match?.scores[guesser.agentId as string]?.points).toBeGreaterThan(0);

    // Round two: roles swap. The guesser from round one now draws.
    const ch2 = await guesser.waitFor("round.choosing", undefined, 10_000);
    expect(ch2.payload.drawerAgentId).toBe(guesser.agentId);
    expect(guesser.isDrawer()).toBe(true);
    expect(guesser.state?.round?.ops).toEqual([]);
    const opts2 =
      guesser.state?.round?.options ?? (await guesser.waitFor("round.wordOptions")).payload.options;
    const started2 = Promise.all([
      drawer.waitFor("round.started"),
      guesser.waitFor("round.started"),
    ]);
    await guesser.chooseWord(1);
    await started2;
    expect(drawer.guessesRemaining()).toBe(3);
    await guesser.draw([line(1)]);
    const matchEnded = drawer.waitFor("match.ended");
    const ok = await drawer.guess(opts2[1]?.word as string);
    expect(ok.result).toBe("correct");
    const me = await matchEnded;
    expect(me.payload.winnerAgentId).toBeDefined();
    expect(drawer.state?.status).toBe("finished");

    await Promise.all([ca.close(), cb.close()]);
  });

  it("paces 300 ops without RATE_LIMITED and with contiguous opSeq", async () => {
    const { ca, cb } = await twoAgents();
    const { drawer, guesser } = await startRound(ca, cb);
    const errors: string[] = [];
    drawer.on("error", (m) => errors.push(m.payload.code));
    const t0 = Date.now();
    const last = guesser.waitFor("draw.op", (m) => m.payload.opSeq === 300, 30_000);
    const res = await drawer.draw(Array.from({ length: 300 }, (_, i) => line(i)));
    await last;
    const elapsed = Date.now() - t0;
    expect(errors).toEqual([]);
    expect(res.batches).toHaveLength(15);
    expect(res).toMatchObject({ opSeqFrom: 1, opSeqTo: 300 });
    // Batches are acked in send order with contiguous ranges.
    let expectNext = 1;
    for (const b of res.batches) {
      expect(b.opSeqFrom).toBe(expectNext);
      expectNext = b.opSeqTo + 1;
    }
    const seqs = guesser.state?.round?.ops.map((e) => e.opSeq) ?? [];
    expect(seqs).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
    // 300 ops with a 28-op head start at 30/s needs about 9 s; must not be instant.
    expect(elapsed).toBeGreaterThan(8_000);
    expect(elapsed).toBeLessThan(14_000);
    const rest = await getOps(base, drawer.code as string, 290);
    expect(rest.ops.map((e) => e.opSeq)).toEqual([
      291, 292, 293, 294, 295, 296, 297, 298, 299, 300,
    ]);
    await Promise.all([ca.close(), cb.close()]);
  });

  it("erase needs the entitlement; a live grant unlocks it and the state tracks erased ops", async () => {
    const { ca, cb } = await twoAgents();
    const { drawer, guesser } = await startRound(ca, cb);
    await drawer.draw([line(1), line(2), line(3)]);
    await expect(drawer.erase(2)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ProtocolError &&
        e.code === "ENTITLEMENT_REQUIRED" &&
        e.entitlement === "erase",
    );
    await setEntitlements(base, ADMIN_TOKEN, drawer.agentId as string, { grant: ["erase"] });
    const erased = guesser.waitFor("draw.erased");
    await drawer.erase(2);
    await erased;
    expect(guesser.state?.round?.ops.map((e) => Boolean(e.erased))).toEqual([false, true, false]);
    const cleared = guesser.waitFor("draw.cleared");
    await drawer.clear();
    await cleared;
    expect(guesser.state?.round?.ops.every((e) => e.erased)).toBe(true);
    expect(guesser.renderPng({ size: 32 }).length).toBeGreaterThan(0);
    await Promise.all([ca.close(), cb.close()]);
  });

  it("reconnects with the same session after a dropped socket and replays a pending request", async () => {
    const { ca, cb } = await twoAgents();
    const { drawer, guesser } = await startRound(ca, cb);
    await drawer.draw([line(1), line(2)]);
    const events: string[] = [];
    guesser.on("close", (e) => events.push(`close:${e.willReconnect}`));
    guesser.on("reconnecting", (e) => events.push(`reconnecting:${e.attempt}`));
    guesser.on("open", (e) => events.push(`open:${e.reconnect}`));
    const sessionBefore = guesser.sessionId;

    // Kill the underlying socket the hard way (no close frame).
    const reopened = guesser.waitFor("room.state", undefined, 10_000);
    (guesser as unknown as { ws: { terminate(): void } }).ws.terminate();
    // A request issued while offline is queued and sent once the socket is back.
    const pending = guesser.guess("nope");
    const snap = await reopened;
    expect(snap.payload.you.sessionId).toBe(sessionBefore);
    expect(guesser.sessionId).toBe(sessionBefore);
    expect(snap.payload.round?.ops.map((e) => e.opSeq)).toEqual([1, 2]);
    const r = await pending;
    expect(r).toEqual({ result: "incorrect", remaining: 2 });
    expect(events).toEqual(["close:true", "reconnecting:1", "open:true"]);
    // Still a normal player: the drawer keeps drawing and we keep receiving.
    const seen = guesser.waitFor("draw.op", (m) => m.payload.opSeq === 3);
    await drawer.draw([line(3)]);
    await seen;
    expect(guesser.state?.round?.ops).toHaveLength(3);
    await Promise.all([ca.close(), cb.close()]);
  });

  it("does not reconnect when superseded by a second socket for the same agent", async () => {
    const { a, room, ca, cb } = await twoAgents();
    const closed = new Promise<{ code: number; willReconnect: boolean }>((resolve) =>
      ca.on("close", (e) => resolve({ code: e.code, willReconnect: e.willReconnect })),
    );
    const second = new AgentClient({ baseUrl: base, apiKey: a.apiKey });
    await second.connect(room.code);
    const c = await closed;
    expect(c).toEqual({ code: 4001, willReconnect: false });
    expect(ca.connected).toBe(false);
    await expect(ca.ping()).rejects.toBeInstanceOf(Error);
    await Promise.all([second.close(), cb.close()]);
  });

  it("close() is clean and a request afterwards fails fast", async () => {
    const { ca, cb } = await twoAgents();
    await ca.close();
    expect(ca.connected).toBe(false);
    await expect(ca.ready()).rejects.toThrow(/not connected/);
    await cb.close();
  });
});

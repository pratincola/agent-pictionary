/**
 * Phase 4: two server instances in one process share one Redis (PLAN.md
 * §9.6). Rooms are pinned to the node that created them; the single writer
 * stays single. Players are redirected to the owner; spectators may watch
 * through any node; a node that stops heartbeating loses its entries; a
 * node that restarts with the same NODE_ID restores its rooms from the
 * snapshot store.
 */
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArenaServer } from "../src/app.js";
import {
  api,
  createRoom,
  createSession,
  registerAgent,
  resetDb,
  sleep,
  startServer,
  WsClient,
} from "./helpers.js";

/** Own Redis logical DB so parallel suites on the same instance do not collide. */
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6380/7";
const TTL_MS = 900;

let a: ArenaServer;
let b: ArenaServer;
let redis: Redis;

/** Fixed ports (3450+) so a restarted node keeps its public base. */
const PORTS: Record<string, number> = {
  "test-A": 3451,
  "test-B": 3452,
  "test-C": 3453,
  "test-D": 3454,
};

function node(nodeId: string, extra: Record<string, unknown> = {}) {
  return startServer({
    redisUrl: REDIS_URL,
    nodeId,
    roomTtlMs: TTL_MS,
    port: PORTS[nodeId] ?? 0,
    ...extra,
  });
}

beforeAll(async () => {
  redis = new Redis(REDIS_URL);
  await redis.flushdb();
  a = await node("test-A");
  b = await node("test-B");
  await resetDb(a);
}, 60_000);

afterAll(async () => {
  await Promise.all([a.close().catch(() => {}), b.close().catch(() => {})]);
  await redis.flushdb();
  await redis.quit();
});

describe("multi-node: directory + redirect + spectator fan-out", () => {
  it("room created on A is owned by A in Redis; node A published its public bases", async () => {
    const room = await createRoom(a.baseUrl);
    expect(await redis.get(`room:${room.code}`)).toBe("test-A");
    expect(await redis.hgetall("node:test-A")).toEqual({ restBase: a.baseUrl, wsBase: a.wsBase });
    expect(await redis.smembers("node:test-A:rooms")).toContain(room.code);
    expect(await redis.pttl(`room:${room.code}`)).toBeGreaterThan(0);
  });

  it("GET /rooms/:code and player sessions on B redirect (307) to A's REST base", async () => {
    const room = await createRoom(a.baseUrl);
    const res = await fetch(`${b.baseUrl}/rooms/${room.code}`, { redirect: "manual" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${a.baseUrl}/rooms/${room.code}`);

    const reg = await registerAgent(b.baseUrl, "redirected");
    const sess = await fetch(`${b.baseUrl}/rooms/${room.code}/sessions`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", authorization: `Bearer ${reg.apiKey}` },
      body: JSON.stringify({ role: "agent" }),
    });
    expect(sess.status).toBe(307);
    expect(sess.headers.get("location")).toBe(`${a.baseUrl}/rooms/${room.code}/sessions`);
    // Unknown room: 404 on both nodes.
    expect((await api(b.baseUrl, "GET", "/rooms/ZZZZZZ")).status).toBe(404);
  });

  it("an agent token for a room on A cannot open a socket on B (single writer)", async () => {
    const room = await createRoom(a.baseUrl);
    const reg = await registerAgent(a.baseUrl, "player");
    const sess = await createSession(a.baseUrl, room.code, "agent", { apiKey: reg.apiKey });
    const wrongNode = sess.wsUrl.replace(a.wsBase, b.wsBase);
    const c = new WsClient(wrongNode, "wrong-node");
    const closed = await c.closed;
    expect(closed.code).toBe(1006); // upgrade refused with 409
  });

  it("spectator on B gets room.state, then every broadcast with A's seq; guesses run on A's actor", async () => {
    const regs = await Promise.all([registerAgent(a.baseUrl, "d"), registerAgent(a.baseUrl, "g")]);
    const [d, g] = regs as [(typeof regs)[0], (typeof regs)[1]];
    const room = await createRoom(a.baseUrl, d.apiKey, {
      roundsPerPlayer: 1,
      chooseSeconds: 20,
      drawSeconds: 30,
      revealSeconds: 1,
    });
    const specA = await WsClient.connect(
      (await createSession(a.baseUrl, room.code, "spectator")).wsUrl,
      "specA",
    );
    const sessB = await createSession(b.baseUrl, room.code, "spectator");
    expect(sessB.wsUrl.startsWith(b.wsBase)).toBe(true);
    const specB = await WsClient.connect(sessB.wsUrl, "specB");
    const stateB = await specB.any("room.state");
    expect(stateB.payload.code).toBe(room.code);
    expect(stateB.payload.you).toEqual({ sessionId: sessB.sessionId, role: "spectator" });
    await specA.any("room.state");

    const drawer = await WsClient.connect(
      (await createSession(a.baseUrl, room.code, "agent", { apiKey: d.apiKey })).wsUrl,
      "drawer",
    );
    const guesser = await WsClient.connect(
      (await createSession(a.baseUrl, room.code, "agent", { apiKey: g.apiKey })).wsUrl,
      "guesser",
    );
    await drawer.any("room.state");
    await guesser.any("room.state");
    // Relay spectators see the lobby change with the owner's seq.
    const joinedB = await specB.waitFor(
      (m) => m.type === "room.playerJoined" && (m.payload as { name: string }).name === "g",
    );
    const joinedA = await specA.waitFor(
      (m) => m.type === "room.playerJoined" && (m.payload as { name: string }).name === "g",
    );
    expect(joinedB).toEqual(joinedA);

    await Promise.all([drawer.request("room.ready", {}), guesser.request("room.ready", {})]);
    await drawer.any("round.wordOptions");
    const opts = (await drawer.any("round.wordOptions")).payload.options;
    await drawer.request("word.choose", { index: 0 });
    await specB.any("round.started");

    const ack = await drawer.request("draw.ops", {
      ops: [{ kind: "line", from: [0, 0], to: [100, 100], width: 2, color: "#000000" }],
    });
    expect(ack.type).toBe("ack");
    const opB = await specB.any("draw.op");
    const opA = await specA.any("draw.op");
    expect(opB).toEqual(opA);

    // Ping is answered locally by the relay; anything else is refused without touching state.
    const pong = await specB.request("ping", {});
    expect(pong.type).toBe("pong");
    const refused = await specB.request("guess.submit", { text: "x" });
    expect(refused.type).toBe("error");

    // The guess goes through A's actor; B only relays the feed.
    const word = (opts[0] as { word: string }).word;
    const res = await guesser.request("guess.submit", { text: word });
    expect(res.type).toBe("guess.result");
    const endedB = await specB.any("round.ended");
    const endedA = await specA.any("round.ended");
    expect(endedB).toEqual(endedA);
    expect(endedB.payload.winner?.seq).toBe(res.seq);
    expect(b.rooms.get(room.code)).toBeUndefined();
    expect(b.rooms.getRelay(room.code)).toBeDefined();

    // Every broadcast seq the relay delivered is one A also delivered, in order.
    const tagged = (c: WsClient) =>
      c.messages
        .filter((m) => m.type !== "room.state" && !m.replyTo)
        .map((m) => `${m.seq}:${m.type}`);
    expect(tagged(specB)).toEqual(
      tagged(specA).filter((s) => Number(s.split(":")[0]) > stateB.seq),
    );

    await Promise.all([specA.close(), specB.close(), drawer.close(), guesser.close()]);
    await sleep(50);
    expect(b.rooms.getRelay(room.code)).toBeUndefined();
  });

  it("a relay spectator is closed when the owner closes the room", async () => {
    const room = await createRoom(a.baseUrl);
    const specB = await WsClient.connect(
      (await createSession(b.baseUrl, room.code, "spectator")).wsUrl,
      "specB",
    );
    await specB.any("room.state");
    await a.rooms.remove(room.code);
    const closed = await specB.closed;
    expect(closed.code).toBe(4404);
    expect(await redis.get(`room:${room.code}`)).toBeNull();
  });

  it("directory entry expires when the owner stops heartbeating", async () => {
    const room = await createRoom(a.baseUrl);
    a.rooms.stopHeartbeat();
    await sleep(TTL_MS + 300);
    expect(await redis.get(`room:${room.code}`)).toBeNull();
    expect((await api(b.baseUrl, "GET", `/rooms/${room.code}`)).status).toBe(404);
    // A itself still serves it (the actor is local); once the heartbeat resumes it re-claims.
    expect((await api(a.baseUrl, "GET", `/rooms/${room.code}`)).status).toBe(200);
    await a.rooms.start({ nodeId: "test-A", restBase: a.restBase, wsBase: a.wsBase });
    await sleep(Math.floor(TTL_MS / 3) + 200);
    expect(await redis.get(`room:${room.code}`)).toBe("test-A");
    const viaB = await fetch(`${b.baseUrl}/rooms/${room.code}`, { redirect: "manual" });
    expect(viaB.status).toBe(307);
  });
});

describe("multi-node: snapshot restore after a restart with the same NODE_ID", () => {
  it("restores lobby players and match scores; old session tokens reconnect", async () => {
    let c = await node("test-C");
    const regs = await Promise.all([
      registerAgent(c.baseUrl, "p1"),
      registerAgent(c.baseUrl, "p2"),
    ]);
    const [p1, p2] = regs as [(typeof regs)[0], (typeof regs)[1]];
    const room = await createRoom(c.baseUrl, p1.apiKey, {
      roundsPerPlayer: 1,
      chooseSeconds: 20,
      drawSeconds: 30,
      revealSeconds: 60,
    });
    const s1 = await createSession(c.baseUrl, room.code, "agent", { apiKey: p1.apiKey });
    const s2 = await createSession(c.baseUrl, room.code, "agent", { apiKey: p2.apiKey });
    const w1 = await WsClient.connect(s1.wsUrl, "p1");
    const w2 = await WsClient.connect(s2.wsUrl, "p2");
    await w1.any("room.state");
    await w2.any("room.state");
    await Promise.all([w1.request("room.ready", {}), w2.request("room.ready", {})]);
    const choosing = await w1.any("round.choosing");
    const drawer = choosing.payload.drawerAgentId === p1.agentId ? w1 : w2;
    const guesser = drawer === w1 ? w2 : w1;
    const opts = (await drawer.any("round.wordOptions")).payload.options;
    await drawer.request("word.choose", { index: 0 });
    await guesser.any("round.started");
    await guesser.request("guess.submit", { text: (opts[0] as { word: string }).word });
    const ended = await w1.any("round.ended");
    expect(ended.payload.winner).toBeDefined();
    const scoresBefore = ended.payload.scores;

    // Graceful stop: sockets close with 1001, the snapshot and restore list stay.
    await c.close();
    expect((await w1.closed).code).toBe(1001);
    expect(await redis.get(`room:${room.code}`)).toBeNull();
    expect(await redis.smembers("node:test-C:rooms")).toContain(room.code);
    expect(await redis.exists(`room:${room.code}:snapshot`)).toBe(1);

    c = await node("test-C");
    try {
      expect(await redis.get(`room:${room.code}`)).toBe("test-C");
      const state = await api<{ status: string; players: { name: string }[] }>(
        c.baseUrl,
        "GET",
        `/rooms/${room.code}`,
      );
      expect(state.status).toBe(200);
      expect(state.body.players.map((p) => p.name).sort()).toEqual(["p1", "p2"]);
      // Reconnect with the pre-restart token: same session, restored scores.
      const back = await WsClient.connect(s1.wsUrl, "p1-again");
      const snap = await back.any("room.state");
      expect(snap.payload.you.sessionId).toBe(s1.sessionId);
      expect(snap.payload.match?.scores).toEqual(scoresBefore);
      expect(snap.payload.status).toBe("playing");
      await back.close();
    } finally {
      await c.close();
    }
  });

  it("a finished room is not restored and its keys are gone", async () => {
    let c = await node("test-D");
    const room = await createRoom(c.baseUrl);
    await c.rooms.remove(room.code);
    expect(await redis.exists(`room:${room.code}:snapshot`)).toBe(0);
    expect(await redis.smembers("node:test-D:rooms")).not.toContain(room.code);
    await c.close();
    c = await node("test-D");
    expect(c.rooms.get(room.code)).toBeUndefined();
    await c.close();
  });
});

describe("operational routes", () => {
  it("/readyz reports db + redis; /metrics exposes the arena series", async () => {
    const ready = await api<{ ok: boolean; checks: Record<string, boolean> }>(
      a.baseUrl,
      "GET",
      "/readyz",
    );
    expect(ready.status).toBe(200);
    expect(ready.body.checks).toEqual({ db: true, redis: true, accepting: true });
    const res = await fetch(`${a.baseUrl}/metrics`);
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const name of [
      "ap_rooms_active",
      "ap_sessions_connected",
      "ap_ws_messages_total",
      "ap_draw_ops_total",
      "ap_guesses_total",
      "ap_round_duration_seconds",
      "ap_broadcast_latency_seconds",
      "ap_actor_queue_depth",
      "process_cpu_seconds_total",
    ]) {
      expect(text).toContain(name);
    }
    expect(text).toMatch(/ap_draw_ops_total\{node="test-A"\} [1-9]/);
    expect(text).toMatch(/ap_guesses_total\{[^}]*result="correct"[^}]*\} [1-9]/);
  });

  it("REST rate limits: per-IP on /agents and /rooms, per-session on canvas.png", async () => {
    const s = await startServer({
      rateLimit: { agentsPerMinute: 2, roomsPerMinute: 1, canvasPerSecond: 1 },
    });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 3; i++)
        codes.push(
          (await api(s.baseUrl, "POST", "/agents", { name: `n${i}`, humanHandle: "h" })).status,
        );
      expect(codes).toEqual([201, 201, 429]);
      expect((await api(s.baseUrl, "POST", "/rooms", { gameId: "pictionary" })).status).toBe(201);
      const limited = await api<{ error: { code: string } }>(s.baseUrl, "POST", "/rooms", {
        gameId: "pictionary",
      });
      expect(limited.status).toBe(429);
      const room = await createRoom(a.baseUrl);
      const t1 = (await createSession(a.baseUrl, room.code, "spectator")).sessionToken;
      const t2 = (await createSession(a.baseUrl, room.code, "spectator")).sessionToken;
      // Different sessions from the same IP do not share a bucket; a repeat within 1 s is 429.
      const first = await fetch(`${s.baseUrl}/rooms/${room.code}/canvas.png?token=${t1}`, {
        redirect: "manual",
      });
      expect(first.status).not.toBe(429);
      expect(
        (await fetch(`${s.baseUrl}/rooms/${room.code}/canvas.png?token=${t2}`)).status,
      ).not.toBe(429);
      expect(
        (
          await fetch(`${s.baseUrl}/rooms/${room.code}/canvas.png?token=${t1}`, {
            redirect: "manual",
          })
        ).status,
      ).toBe(429);
      const metrics = await (await fetch(`${s.baseUrl}/metrics`)).text();
      expect(metrics).toMatch(/ap_rest_rate_limited_total\{[^}]*route="\/agents"[^}]*\} 1/);
    } finally {
      await s.close();
    }
  });
});

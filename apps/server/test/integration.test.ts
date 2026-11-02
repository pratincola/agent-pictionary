import type {
  AgentPublic,
  LeaderboardResponse,
  OpsResponse,
  RoomPublic,
  ServerMessageOf,
} from "@pictionary/protocol";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArenaServer } from "../src/app.js";
import { schema } from "../src/db/index.js";
import {
  api,
  createRoom,
  createSession,
  type Player,
  registerAgent,
  resetDb,
  setupRoom,
  startServer,
  WsClient,
} from "./helpers.js";

let server: ArenaServer;
let base: string;

beforeAll(async () => {
  server = await startServer();
  base = server.baseUrl;
  await resetDb(server);
});
afterAll(async () => {
  await server.close();
});

describe("REST", () => {
  it("healthz", async () => {
    const r = await api<{ ok: true }>(base, "GET", "/healthz");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it("registers an agent, hashes the key, exposes public stats", async () => {
    const reg = await registerAgent(base, "Picasso", "prat");
    expect(reg.apiKey.startsWith(`${reg.agentId}.`)).toBe(true);
    const row = await server.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, reg.agentId));
    expect(row[0]?.apiKeyHash.startsWith("scrypt$")).toBe(true);
    expect(row[0]?.apiKeyHash.includes(reg.apiKey.split(".")[1] as string)).toBe(false);
    const pub = await api<AgentPublic>(base, "GET", `/agents/${reg.agentId}`);
    expect(pub.status).toBe(200);
    expect(pub.body).toEqual({
      id: reg.agentId,
      name: "Picasso",
      tier: "free",
      entitlements: [],
      stats: { matches: 0, roundsDrawn: 0, wins: 0, points: 0 },
    });
    expect((await api(base, "GET", `/agents/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await api(base, "POST", "/agents", { name: "" })).status).toBe(400);
  });

  it("creates and reads rooms; unknown codes are ROOM_NOT_FOUND", async () => {
    const reg = await registerAgent(base, "Creator");
    const room = await createRoom(base, reg.apiKey, { drawSeconds: 30 });
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const got = await api<RoomPublic>(base, "GET", `/rooms/${room.code}`);
    expect(got.status).toBe(200);
    expect(got.body.status).toBe("lobby");
    expect(got.body.config.drawSeconds).toBe(30);
    expect(got.body.config.roundsPerPlayer).toBe(1);
    const missing = await api<{ error: { code: string } }>(base, "GET", "/rooms/ZZZZZZ");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("ROOM_NOT_FOUND");
    const bad = await api<{ error: { code: string } }>(
      base,
      "POST",
      "/rooms",
      {},
      { authorization: "Bearer nope.nope" },
    );
    expect(bad.status).toBe(401);
    // Anonymous room creation works too.
    const anon = await createRoom(base);
    expect(anon.code).toHaveLength(6);
  });

  it("sessions: agent role needs a key; human pairs by code; spectators are anonymous", async () => {
    const reg = await registerAgent(base, "Sess");
    const room = await createRoom(base, reg.apiKey);
    const noKey = await api<{ error: { code: string } }>(
      base,
      "POST",
      `/rooms/${room.code}/sessions`,
      { role: "agent" },
    );
    expect(noKey.status).toBe(401);
    expect(noKey.body.error.code).toBe("UNAUTHORIZED");
    const s = await createSession(base, room.code, "agent", { apiKey: reg.apiKey });
    expect(s.wsUrl.startsWith(`${server.wsBase}/ws?token=`)).toBe(true);
    const h = await createSession(base, room.code, "human", { pairCode: reg.humanPairCode });
    expect(h.sessionId).not.toBe(s.sessionId);
    const badPair = await api<{ error: { code: string } }>(
      base,
      "POST",
      `/rooms/${room.code}/sessions`,
      {
        role: "human",
        pairCode: "NOPE",
      },
    );
    expect(badPair.status).toBe(401);
    const spec = await createSession(base, room.code, "spectator");
    expect(spec.sessionToken.split(".")).toHaveLength(2);
    const rows = await server.db.select().from(schema.sessions);
    expect(rows.filter((r) => r.roomId !== undefined).length).toBeGreaterThanOrEqual(3);
  });

  it("canvas.png is a 501 stub; admin needs the token; leaderboard is empty-safe", async () => {
    const reg = await registerAgent(base, "Canvas");
    const room = await createRoom(base, reg.apiKey);
    expect((await api(base, "GET", `/rooms/${room.code}/canvas.png`)).status).toBe(501);
    const unauth = await api(base, "POST", `/admin/agents/${reg.agentId}/entitlements`, {
      grant: ["erase"],
    });
    expect(unauth.status).toBe(401);
    const ok = await api<{ entitlements: string[]; tier: string }>(
      base,
      "POST",
      `/admin/agents/${reg.agentId}/entitlements`,
      { grant: ["erase"] },
      { authorization: "Bearer test-admin-token" },
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ entitlements: ["erase"], tier: "paid" });
    const lb = await api<LeaderboardResponse>(base, "GET", "/leaderboard");
    expect(lb.status).toBe(200);
    expect(Array.isArray(lb.body.agents)).toBe(true);
  });

  it("ws upgrade rejects bad tokens and non-/ws paths", async () => {
    const reg = await registerAgent(base, "Upg");
    const room = await createRoom(base, reg.apiKey);
    const bad = new WsClient(`${server.wsBase}/ws?token=garbage`);
    const closed = await bad.closed;
    expect(closed.code).toBe(1006);
    const s = await createSession(base, room.code, "spectator");
    const wrongPath = new WsClient(s.wsUrl.replace("/ws?", "/other?"));
    expect((await wrongPath.closed).code).toBe(1006);
  });
});

describe("full match over real sockets", () => {
  it("3 agents + paired human + spectator play every round; DB rows equal broadcasts", async () => {
    const { room, players } = await setupRoom(base, 3, { revealSeconds: 0, drawSeconds: 60 });
    const [p0, p1, p2] = players as [Player, Player, Player];
    // Human paired to agent1 and a spectator.
    const hs = await createSession(base, room.code, "human", { pairCode: p1.pairCode });
    const human = await WsClient.connect(hs.wsUrl, "human1");
    const humanState = await human.any("room.state");
    expect(humanState.payload.you).toMatchObject({ role: "human", agentId: p1.agentId });
    const ss = await createSession(base, room.code, "spectator");
    const spec = await WsClient.connect(ss.wsUrl, "spec");
    await spec.any("room.state");
    const everyone = [p0.ws, p1.ws, p2.ws, human, spec];

    // Snapshot sanity: players listed, humans counted.
    const pub = await api<RoomPublic>(base, "GET", `/rooms/${room.code}`);
    expect(pub.body.players.map((p) => p.agentId)).toEqual(players.map((p) => p.agentId));
    expect(pub.body.players.find((p) => p.agentId === p1.agentId)?.humans).toBe(1);

    // Ready up -> match starts (auto-start when all ready).
    for (const p of players) {
      const r = await p.ws.request("room.ready", {});
      expect(r.type).toBe("ack");
    }
    const started = await p0.ws.any("match.started");
    expect(started.payload.order).toEqual(players.map((p) => p.agentId));
    expect(started.payload.roundsTotal).toBe(3);

    const roundEnds: ServerMessageOf<"round.ended">[] = [];
    const guessLog: { round: number; agentId: string; text: string; result: string }[] = [];

    for (let round = 0; round < 3; round++) {
      const isChoosing = (m: { type: string; payload: unknown }) =>
        m.type === "round.choosing" && (m.payload as { roundIndex: number }).roundIndex === round;
      const choosingAll = await Promise.all(everyone.map((c) => c.waitFor(isChoosing)));
      // Per-client inbox position of this round's start, so lookups ignore earlier rounds.
      const marks = new Map(
        everyone.map((c, i) => [c, c.messages.indexOf(choosingAll[i] as never)]),
      );
      const choosing = choosingAll[0] as ServerMessageOf<"round.choosing">;
      const drawerId = (choosing.payload as { drawerAgentId: string }).drawerAgentId;
      expect(drawerId).toBe(players[round]?.agentId);
      const drawer = players[round] as Player;
      const guessers = players.filter((p) => p !== drawer);
      const options = await drawer.ws.next("round.wordOptions", marks.get(drawer.ws));
      const words = options.payload.options;
      expect(words).toHaveLength(3);
      // Guessers only ever saw options for rounds they drew themselves.
      for (const g of guessers) {
        expect(g.ws.all("round.wordOptions")).toHaveLength(players.indexOf(g) < round ? 1 : 0);
      }

      const chosen = await drawer.ws.request("word.choose", { index: 1 });
      expect(chosen.type).toBe("ack");
      const word = (words[1] as { word: string }).word;
      const startedMsgs = await Promise.all(
        everyone.map((c) => c.next("round.started", marks.get(c))),
      );
      for (const m of startedMsgs) {
        expect(m.payload.drawerAgentId).toBe(drawerId);
        expect(m.payload.roundIndex).toBe(round);
        expect(JSON.stringify(m)).not.toContain(`"word":"${word}"`);
      }

      // Drawer draws two ops; every client sees opSeq 1 and 2.
      const ack = await drawer.ws.request("draw.ops", {
        ops: [
          {
            kind: "path",
            points: [
              [10, 10],
              [200, 200],
              [300, 100],
            ],
            width: 4,
            color: "#112233",
          },
          {
            kind: "ellipse",
            cx: 500,
            cy: 500,
            rx: 100,
            ry: 60,
            width: 2,
            color: "#000000",
            fill: "#ffcc00",
          },
        ],
      });
      expect(ack.type).toBe("ack");
      expect(ack.payload).toEqual({ opSeqFrom: 1, opSeqTo: 2 });
      await Promise.all(
        everyone.map((c) =>
          c.waitFor(
            (m) => m.type === "draw.op" && (m.payload as { opSeq: number }).opSeq === 2,
            10_000,
            "draw.op",
            marks.get(c),
          ),
        ),
      );
      const ops = await api<OpsResponse>(base, "GET", `/rooms/${room.code}/ops?after=1`);
      expect(ops.body.roundIndex).toBe(round);
      expect(ops.body.ops.map((o) => o.opSeq)).toEqual([2]);

      // First guesser misses, second guesser hits.
      const [g0, g1] = guessers as [Player, Player];
      const missText = `definitely not it ${round}`;
      const countMark = drawer.ws.mark();
      const miss = await g0.ws.request("guess.submit", { text: missText });
      expect(miss.type).toBe("guess.result");
      expect(miss.payload).toEqual({ result: "incorrect", remaining: 2 });
      guessLog.push({ round, agentId: g0.agentId, text: missText, result: "incorrect" });
      const count = await drawer.ws.next("guess.count", countMark);
      expect(count.payload.wrongGuesses).toBe(1);
      const feed = await spec.waitFor(
        (m) => m.type === "guess.feed" && (m.payload as { text: string }).text === missText,
      );
      expect((feed.payload as { agentId: string; source: string }).agentId).toBe(g0.agentId);
      expect((feed.payload as { source: string }).source).toBe("agent");
      await human.waitFor(
        (m) => m.type === "guess.feed" && (m.payload as { text: string }).text === missText,
      );
      // Agents never see the feed.
      for (const p of players) expect(p.ws.all("guess.feed")).toHaveLength(0);

      // The human's agent (agent1) still has guesses left, so the human may not guess yet.
      if (g0.agentId === p1.agentId || g1.agentId === p1.agentId) {
        const early = await human.request("human.guess", { text: word });
        expect(early.type).toBe("error");
        expect((early.payload as { code: string }).code).toBe("NOT_GUESSER");
      }

      const hitText = `the ${word.toUpperCase()}!`;
      const hit = await g1.ws.request("guess.submit", { text: hitText });
      expect(hit.type).toBe("guess.result");
      expect((hit.payload as { result: string }).result).toBe("correct");
      guessLog.push({ round, agentId: g1.agentId, text: hitText, result: "correct" });

      const ends = await Promise.all(
        everyone.map((c) =>
          c.waitFor(
            (m) =>
              m.type === "round.ended" &&
              (m.payload as { roundIndex: number }).roundIndex === round,
            10_000,
            "round.ended",
            marks.get(c),
          ),
        ),
      );
      const ended = ends[0] as ServerMessageOf<"round.ended">;
      expect(ended.payload.word).toBe(word);
      expect(ended.payload.reason).toBe("guessed");
      expect(ended.payload.winner?.agentId).toBe(g1.agentId);
      expect(ended.payload.roundScores[drawerId]).toEqual({
        points: 5,
        agentPoints: 5,
        humanPoints: 0,
      });
      expect(ended.payload.roundScores[g1.agentId]?.points).toBeGreaterThanOrEqual(10);
      // Identical payload for all five clients.
      expect(new Set(ends.map((e) => JSON.stringify(e.payload))).size).toBe(1);
      roundEnds.push(ended);
    }

    const matchEnded = await Promise.all(everyone.map((c) => c.any("match.ended")));
    const final = (matchEnded[0] as ServerMessageOf<"match.ended">).payload;
    expect(new Set(matchEnded.map((m) => JSON.stringify(m.payload))).size).toBe(1);
    expect(final.matchId).toBe(started.payload.matchId);
    expect(final.scores).toEqual(roundEnds[2]?.payload.scores);

    // --- Database agrees with what was broadcast ---------------------------
    const matchRows = await server.db
      .select()
      .from(schema.matches)
      .where(eq(schema.matches.id, final.matchId));
    expect(matchRows).toHaveLength(1);
    expect(matchRows[0]?.endedAt).not.toBeNull();

    const roundRows = await server.db
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.matchId, final.matchId))
      .orderBy(asc(schema.rounds.index));
    expect(roundRows).toHaveLength(3);
    for (const [i, row] of roundRows.entries()) {
      const b = roundEnds[i] as ServerMessageOf<"round.ended">;
      expect(row.word).toBe(b.payload.word);
      expect(row.reason).toBe("guessed");
      expect(row.winnerAgentId).toBe(b.payload.winner?.agentId);
      expect(row.winningSeq).toBe(b.payload.winner?.seq);
      expect(row.winnerSource).toBe("agent");
      expect(row.wordSource).toBe("pool");
      expect(typeof row.winningRecvNs).toBe("bigint");

      const guessRows = await server.db
        .select()
        .from(schema.guesses)
        .where(eq(schema.guesses.roundId, row.id))
        .orderBy(asc(schema.guesses.seq));
      const expected = guessLog.filter((g) => g.round === i);
      expect(
        guessRows.map((g) => ({ agentId: g.agentId, text: g.text, result: g.result })),
      ).toEqual(expected.map(({ agentId, text, result }) => ({ agentId, text, result })));
      expect(guessRows.at(-1)?.seq).toBe(b.payload.winner?.seq);

      const opRows = await server.db
        .select()
        .from(schema.drawOps)
        .where(eq(schema.drawOps.roundId, row.id));
      expect(opRows.map((o) => o.opSeq).sort()).toEqual([1, 2]);
    }

    const scoreRows = await server.db
      .select()
      .from(schema.scores)
      .where(eq(schema.scores.matchId, final.matchId));
    const fromDb = Object.fromEntries(
      scoreRows.map((s) => [
        s.agentId,
        { points: s.points, agentPoints: s.agentPoints, humanPoints: s.humanPoints },
      ]),
    );
    expect(fromDb).toEqual(final.scores);

    const stats = await api<AgentPublic>(base, "GET", `/agents/${p0.agentId}`);
    expect(stats.body.stats.matches).toBe(1);
    expect(stats.body.stats.roundsDrawn).toBe(1);
    expect(stats.body.stats.points).toBe(final.scores[p0.agentId]?.points);
    const lb = await api<LeaderboardResponse>(base, "GET", "/leaderboard");
    const top = lb.body.agents[0];
    expect(top?.agentId).toBe(final.winnerAgentId);

    const roomRow = await server.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.code, room.code));
    expect(roomRow[0]?.status).toBe("finished");
    const pubAfter = await api<RoomPublic>(base, "GET", `/rooms/${room.code}`);
    expect(pubAfter.body.status).toBe("finished");

    await Promise.all(everyone.map((c) => c.close()));
  });
});

/**
 * Chaos (PLAN.md §14.6): duplicates, garbage, paid ops from free agents,
 * drawer disconnects, and a failing database write.
 */
import type { ServerMessageOf } from "@pictionary/protocol";
import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArenaServer } from "../src/app.js";
import { schema } from "../src/db/index.js";
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

describe("chaos", () => {
  it("duplicate guess.submit with the same id is idempotent", async () => {
    const { players } = await setupRoom(base, 3);
    const { guessers } = await startAndChoose(players);
    const g = guessers[0] as Player;
    const first = (await g.ws.request(
      "guess.submit",
      { text: "no idea" },
      { id: "dup-1" },
    )) as ServerMessageOf<"guess.result">;
    expect(first.payload).toEqual({ result: "incorrect", remaining: 2 });
    const mark = g.ws.mark();
    await g.ws.sendRaw(
      JSON.stringify({
        type: "guess.submit",
        id: "dup-1",
        ts: Date.now(),
        payload: { text: "no idea" },
      }),
    );
    const second = (await g.ws.waitFor(
      (m) => m.replyTo === "dup-1",
      5_000,
      "dup reply",
      mark,
    )) as ServerMessageOf<"guess.result">;
    expect(second.payload).toEqual(first.payload); // same remaining: no second guess consumed
    expect(second.seq).toBe(first.seq);
    // A fresh id consumes the next guess, proving the duplicate did not.
    const third = (await g.ws.request("guess.submit", {
      text: "still no",
    })) as ServerMessageOf<"guess.result">;
    expect(third.payload.remaining).toBe(1);
    // Room state holds two guesses, not three.
    const round = server.rooms
      .list()
      .find((a) => a.peek().players[g.agentId])
      ?.peek().game?.round;
    expect(round?.guesses).toHaveLength(2);
    await Promise.all(players.map((p) => p.ws.close()));
  });

  it("malformed JSON and schema violations return BAD_REQUEST and keep the socket open", async () => {
    const { players } = await setupRoom(base, 2);
    const { drawer } = await startAndChoose(players);
    const mark = drawer.ws.mark();
    await drawer.ws.sendRaw("{this is not json");
    const err = await drawer.ws.next("error", mark);
    expect(err.payload.code).toBe("BAD_REQUEST");
    expect(err.replyTo).toBeUndefined();
    // Unknown type, with an id: the error carries replyTo.
    await drawer.ws.sendRaw(JSON.stringify({ type: "chat.say", id: "bad-1", ts: 1, payload: {} }));
    const err2 = await drawer.ws.waitFor((m) => m.replyTo === "bad-1");
    expect(err2.type).toBe("error");
    // A text op does not exist in the protocol.
    const err3 = await drawer.ws.request("draw.ops", {
      ops: [{ kind: "text", x: 1, y: 1, text: "CAT" } as never],
    });
    expect(err3.type).toBe("error");
    expect((err3.payload as { code: string }).code).toBe("BAD_REQUEST");
    // Out-of-bounds coordinates.
    const err4 = await drawer.ws.request("draw.ops", {
      ops: [{ kind: "line", from: [0, 0], to: [1001, 5], width: 2, color: "#000000" }],
    });
    expect((err4.payload as { code: string }).code).toBe("BAD_REQUEST");
    // Binary frame.
    const mark2 = drawer.ws.mark();
    drawer.ws.ws.send(Buffer.from([1, 2, 3]));
    expect((await drawer.ws.next("error", mark2)).payload.code).toBe("BAD_REQUEST");
    // Still alive and still the drawer.
    const pong = await drawer.ws.request("ping", {});
    expect(pong.type).toBe("pong");
    const ok = await drawer.ws.request("draw.ops", {
      ops: [{ kind: "line", from: [0, 0], to: [10, 5], width: 2, color: "#000000" }],
    });
    expect(ok.type).toBe("ack");
    expect(drawer.ws.ws.readyState).toBe(drawer.ws.ws.OPEN);
    await Promise.all(players.map((p) => p.ws.close()));
  });

  it("free agent draw.erase -> ENTITLEMENT_REQUIRED; granting via admin unlocks it live", async () => {
    const { players } = await setupRoom(base, 2);
    const { drawer, guessers } = await startAndChoose(players);
    await drawer.ws.request("draw.ops", {
      ops: [{ kind: "line", from: [0, 0], to: [10, 5], width: 2, color: "#000000" }],
    });
    const denied = await drawer.ws.request("draw.erase", { opSeq: 1 });
    expect(denied.type).toBe("error");
    expect(denied.payload).toEqual({
      code: "ENTITLEMENT_REQUIRED",
      message: expect.any(String),
      entitlement: "erase",
    });
    const deniedClear = await drawer.ws.request("draw.clear", {});
    expect((deniedClear.payload as { code: string }).code).toBe("ENTITLEMENT_REQUIRED");

    const grant = await api(
      base,
      "POST",
      `/admin/agents/${drawer.agentId}/entitlements`,
      { grant: ["erase"] },
      {
        authorization: "Bearer test-admin-token",
      },
    );
    expect(grant.status).toBe(200);
    // The actor receives agent.entitlements; retry succeeds without reconnecting.
    let ok: Awaited<ReturnType<WsClient["request"]>> | undefined;
    for (let i = 0; i < 20; i++) {
      ok = await drawer.ws.request("draw.erase", { opSeq: 1 });
      if (ok.type === "ack") break;
      await sleep(25);
    }
    expect(ok?.type).toBe("ack");
    const erased = await (guessers[0] as Player).ws.any("draw.erased");
    expect(erased.payload.opSeq).toBe(1);
    await Promise.all(players.map((p) => p.ws.close()));
  });

  it("drawer disconnect -> round skipped after the grace period, no points", async () => {
    const { players } = await setupRoom(base, 3, { drawerGraceMs: 400, revealSeconds: 0 });
    const { drawer, guessers } = await startAndChoose(players);
    const g = guessers[0] as Player;
    const mark = g.ws.mark();
    await drawer.ws.close();
    // Within the grace period the round is still on.
    await sleep(150);
    expect(g.ws.all("round.ended")).toHaveLength(0);
    const ended = await g.ws.next("round.ended", mark);
    expect(ended.payload.reason).toBe("drawer_left");
    expect(ended.payload.winner).toBeUndefined();
    expect(ended.payload.roundScores).toEqual({});
    // The match continues with the next drawer.
    const next = await g.ws.waitFor(
      (m) => m.type === "round.choosing" && (m.payload as { roundIndex: number }).roundIndex === 1,
    );
    expect((next.payload as { drawerAgentId: string }).drawerAgentId).not.toBe(drawer.agentId);
    const row = await server.db
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.reason, "drawer_left"));
    expect(row.length).toBeGreaterThanOrEqual(1);
    await Promise.all(guessers.map((p) => p.ws.close()));
  });

  it("drawer reconnecting within the grace period keeps the round alive and sees the word", async () => {
    const { players } = await setupRoom(base, 2, { drawerGraceMs: 2_000 });
    const { drawer, guessers } = await startAndChoose(players);
    await drawer.ws.close();
    await sleep(100);
    const back = await WsClient.connect(drawer.session.wsUrl, "drawer-2");
    const snap = await back.any("room.state");
    expect(snap.payload.round?.phase).toBe("drawing");
    expect(typeof snap.payload.round?.word).toBe("string");
    expect(snap.payload.round?.wrongGuesses).toBe(0);
    await sleep(2_200);
    expect((guessers[0] as Player).ws.all("round.ended")).toHaveLength(0);
    const ack = await back.request("draw.ops", {
      ops: [{ kind: "line", from: [0, 0], to: [10, 5], width: 2, color: "#000000" }],
    });
    expect(ack.type).toBe("ack");
    await Promise.all([back.close(), ...guessers.map((p) => p.ws.close())]);
  });

  it("a second socket for the same agent supersedes the first", async () => {
    const { room, players } = await setupRoom(base, 2);
    const p = players[0] as Player;
    const again = await createSession(base, room.code, "agent", { apiKey: p.apiKey });
    const ws2 = await WsClient.connect(again.wsUrl, "again");
    await ws2.any("room.state");
    const closed = await p.ws.closed;
    expect(closed.code).toBe(4001);
    const pub = await api<{ players: { agentId: string; connected: boolean }[] }>(
      base,
      "GET",
      `/rooms/${room.code}`,
    );
    expect(pub.body.players).toHaveLength(2);
    expect(pub.body.players.find((x) => x.agentId === p.agentId)?.connected).toBe(true);
    await Promise.all([ws2.close(), (players[1] as Player).ws.close()]);
  });

  it("joining a full room or a started match is refused at the socket", async () => {
    const { room, players } = await setupRoom(base, 2, { maxPlayers: 2 });
    const extra = await (await import("./helpers.js")).registerAgent(base, "late");
    const full = await api<{ error: { code: string } }>(
      base,
      "POST",
      `/rooms/${room.code}/sessions`,
      { role: "agent" },
      { authorization: `Bearer ${extra.apiKey}` },
    );
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("ROOM_FULL");
    await startAndChoose(players);
    const started = await api<{ error: { code: string } }>(
      base,
      "POST",
      `/rooms/${room.code}/sessions`,
      { role: "agent" },
      { authorization: `Bearer ${extra.apiKey}` },
    );
    expect(started.status).toBe(409);
    expect(started.body.error.code).toBe("WRONG_PHASE");
    await Promise.all(players.map((p) => p.ws.close()));
  });

  it("a failed round write still broadcasts round.ended, lands in the outbox, and is retried", async () => {
    const { players } = await setupRoom(base, 2, { revealSeconds: 0 });
    const { drawer, guessers } = await startAndChoose(players);
    const options = drawer.ws.last("round.wordOptions")?.payload.options ?? [];
    const word = (options[0] as { word: string }).word;
    server.persistence.failInjector = (r) => r.type === "round.ended";
    try {
      const g = guessers[0] as Player;
      const res = await g.ws.request("guess.submit", { text: word });
      expect((res.payload as { result: string }).result).toBe("correct");
      const ended = await g.ws.any("round.ended");
      expect(ended.payload.winner?.agentId).toBe(g.agentId);
      const matchId = (await g.ws.any("match.started")).payload.matchId;
      // Not in rounds yet, but parked in the outbox.
      expect(
        await server.db.select().from(schema.rounds).where(eq(schema.rounds.matchId, matchId)),
      ).toHaveLength(0);
      const parked = await server.db
        .select()
        .from(schema.outbox)
        .where(isNull(schema.outbox.sentAt));
      expect(parked.some((o) => o.kind === "round.ended")).toBe(true);
    } finally {
      server.persistence.failInjector = undefined;
    }
    await server.persistence.retry();
    const after = await server.db.select().from(schema.outbox).where(isNull(schema.outbox.sentAt));
    expect(after.filter((o) => o.kind === "round.ended")).toHaveLength(0);
    const rounds = await server.db.select().from(schema.rounds).where(eq(schema.rounds.word, word));
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.winnerAgentId).toBe((guessers[0] as Player).agentId);
    await Promise.all(players.map((p) => p.ws.close()));
  });
});

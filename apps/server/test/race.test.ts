/**
 * The key correctness test (PLAN.md §14.3): 50 guesser agents fire the
 * correct word in the same tick. Exactly one winner, everyone agrees, and the
 * database agrees.
 */
import type { ServerMessageOf } from "@pictionary/protocol";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArenaServer } from "../src/app.js";
import { schema } from "../src/db/index.js";
import { type Player, resetDb, setupRoom, sleep, startServer } from "./helpers.js";

const GUESSERS = 50;
const RUNS = 20;

let server: ArenaServer;
let players: Player[];
let matchId: string;

beforeAll(async () => {
  server = await startServer();
  await resetDb(server);
  const setup = await setupRoom(server.baseUrl, GUESSERS + 1, {
    maxPlayers: GUESSERS + 1,
    roundsPerPlayer: 1,
    chooseSeconds: 30,
    drawSeconds: 60,
    revealSeconds: 1,
  });
  players = setup.players;
  await Promise.all(players.map((p) => p.ws.request("room.ready", {})));
  const started = await (players[0] as Player).ws.any("match.started");
  matchId = started.payload.matchId;
}, 120_000);

afterAll(async () => {
  await Promise.all(players.map((p) => p.ws.close()));
  await server.close();
});

/** Wait for round `index` to reach drawing; drawer picks option 0. Returns the word. */
async function enterDrawing(index: number) {
  const isChoosing = (m: { type: string; payload: unknown }) =>
    m.type === "round.choosing" && (m.payload as { roundIndex: number }).roundIndex === index;
  const choosingAll = await Promise.all(
    players.map((p) => p.ws.waitFor(isChoosing, 20_000, `round.choosing#${index}`)),
  );
  const marks = new Map(players.map((p, i) => [p, p.ws.messages.indexOf(choosingAll[i] as never)]));
  const drawerId = (choosingAll[0] as ServerMessageOf<"round.choosing">).payload.drawerAgentId;
  const drawer = players.find((p) => p.agentId === drawerId) as Player;
  const options = await drawer.ws.next("round.wordOptions", marks.get(drawer));
  await drawer.ws.request("word.choose", { index: 0 });
  await Promise.all(players.map((p) => p.ws.next("round.started", marks.get(p))));
  const word = (options.payload.options[0] as { word: string }).word;
  return { drawer, guessers: players.filter((p) => p !== drawer), word, marks };
}

async function assertOneWinner(
  index: number,
  guessers: Player[],
  marks: Map<Player, number>,
  replies: ServerMessageOf<"guess.result">[],
  correctSenders: Set<string>,
) {
  // Every client gets the same round.ended.
  const ends = await Promise.all(
    players.map((p) =>
      p.ws.waitFor(
        (m) =>
          m.type === "round.ended" && (m.payload as { roundIndex: number }).roundIndex === index,
        20_000,
        `round.ended#${index}`,
        marks.get(p),
      ),
    ),
  );
  expect(new Set(ends.map((e) => JSON.stringify(e))).size).toBe(1); // seq, ts and payload identical
  const ended = (ends[0] as ServerMessageOf<"round.ended">).payload;
  expect(ended.reason).toBe("guessed");
  expect(ended.winner).toBeDefined();
  const winner = ended.winner as { agentId: string; seq: number };
  expect(correctSenders.has(winner.agentId)).toBe(true);

  // Exactly one 'correct' reply; replies from correct senders are correct or late.
  const correct = replies.filter((r) => r.payload.result === "correct");
  expect(correct).toHaveLength(1);
  expect(correct[0]?.seq).toBe(winner.seq);
  const byAgent = new Map(guessers.map((g) => [g.ws, g]));
  void byAgent;
  for (const r of replies) {
    expect(["correct", "late", "round_over", "incorrect"]).toContain(r.payload.result);
    if (r.payload.result === "late" || r.payload.result === "round_over")
      expect(r.seq).toBeGreaterThan(winner.seq);
    if (r.payload.result === "incorrect") expect(r.seq).toBeLessThan(winner.seq);
  }
  // Every correct sender other than the winner got 'late'.
  const lateCount = replies.filter((r) => r.payload.result === "late").length;
  expect(lateCount).toBe(correctSenders.size - 1);

  // Database: the rounds row names the same winner and seq; the guesses table
  // holds every correct guess, and the winner's seq is the minimum.
  const roundRow = (
    await server.db
      .select()
      .from(schema.rounds)
      .where(and(eq(schema.rounds.matchId, matchId), eq(schema.rounds.index, index)))
  )[0];
  expect(roundRow).toBeDefined();
  expect(roundRow?.winnerAgentId).toBe(winner.agentId);
  expect(roundRow?.winningSeq).toBe(winner.seq);
  // Late guesses persist asynchronously (guess.append); wait until all landed.
  let guessRows: (typeof schema.guesses.$inferSelect)[] = [];
  for (let i = 0; i < 100; i++) {
    guessRows = await server.db
      .select()
      .from(schema.guesses)
      .where(eq(schema.guesses.roundId, roundRow?.id as string))
      .orderBy(asc(schema.guesses.seq));
    if (guessRows.length >= replies.length) break;
    await sleep(50);
  }
  expect(guessRows).toHaveLength(replies.length);
  const correctRows = guessRows.filter((g) => g.normalized === ended.word.toLowerCase());
  expect(correctRows).toHaveLength(correctSenders.size);
  expect(Math.min(...correctRows.map((g) => g.seq))).toBe(winner.seq);
  expect(correctRows.filter((g) => g.result === "correct")).toHaveLength(1);
  expect(correctRows.filter((g) => g.result === "late")).toHaveLength(correctSenders.size - 1);
  // recvNs is monotone with seq within the round: the actor saw them in receipt order.
  const ns = guessRows.map((g) => g.recvNs as bigint);
  for (let i = 1; i < ns.length; i++) expect((ns[i] as bigint) > (ns[i - 1] as bigint)).toBe(true);
  return winner;
}

describe(`race: ${GUESSERS} correct guesses in one tick, ${RUNS} runs`, () => {
  for (let run = 0; run < RUNS; run++) {
    const jitter = run % 2 === 1;
    it(`run ${run + 1}/${RUNS}${jitter ? " (0-3 ms jitter)" : " (same tick)"}`, async () => {
      const { guessers, word, marks } = await enterDrawing(run);
      expect(guessers).toHaveLength(GUESSERS);
      const ids = new Map(guessers.map((g) => [g, g.ws.nextId()]));
      const replyPromises = guessers.map((g) =>
        g.ws.waitFor((m) => m.replyTo === ids.get(g), 20_000, "guess.result", marks.get(g)),
      );
      const frame = (g: Player) =>
        JSON.stringify({
          type: "guess.submit",
          id: ids.get(g),
          ts: Date.now(),
          payload: { text: word },
        });
      if (jitter) {
        await Promise.all(
          guessers.map(async (g) => {
            await sleep(Math.random() * 3);
            await g.ws.sendRaw(frame(g));
          }),
        );
      } else {
        await Promise.all(guessers.map((g) => g.ws.sendRaw(frame(g))));
      }
      const replies = (await Promise.all(replyPromises)) as ServerMessageOf<"guess.result">[];
      expect(replies.every((r) => r.type === "guess.result")).toBe(true);
      await assertOneWinner(run, guessers, marks, replies, new Set(guessers.map((g) => g.agentId)));
    }, 60_000);
  }

  it("50 incorrect guesses and 1 correct arrive interleaved: the correct one wins, earlier misses are 'incorrect', later ones 'round_over'", async () => {
    const index = RUNS;
    const { guessers, word, marks } = await enterDrawing(index);
    const correctIdx = 25;
    const ids = new Map(guessers.map((g) => [g, g.ws.nextId()]));
    const replyPromises = guessers.map((g) =>
      g.ws.waitFor((m) => m.replyTo === ids.get(g), 20_000, "guess.result", marks.get(g)),
    );
    await Promise.all(
      guessers.map((g, i) =>
        g.ws.sendRaw(
          JSON.stringify({
            type: "guess.submit",
            id: ids.get(g),
            ts: Date.now(),
            payload: { text: i === correctIdx ? word : `wrong guess ${i}` },
          }),
        ),
      ),
    );
    const replies = (await Promise.all(replyPromises)) as ServerMessageOf<"guess.result">[];
    const correctAgent = (guessers[correctIdx] as Player).agentId;
    const winner = await assertOneWinner(index, guessers, marks, replies, new Set([correctAgent]));
    expect(winner.agentId).toBe(correctAgent);
    expect(
      replies.filter((r) => r.payload.result === "incorrect").length +
        replies.filter((r) => r.payload.result === "round_over").length,
    ).toBe(GUESSERS - 1);
    expect(replies.filter((r) => r.payload.result === "late")).toHaveLength(0);
  }, 60_000);
});

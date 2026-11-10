/**
 * race: N guesser agents and one drawer. When the round starts, every
 * guesser fires the correct word in the same tick. Prints the winner and the
 * seq audit from `round.ended` (PLAN.md §9: lowest seq among correct guesses).
 */
import type { GuessResult as GuessResultKind } from "@pictionary/protocol";
import { AgentClient, createRoom, registerAgent } from "@pictionary/sdk";
import type { Logger } from "./util.js";

export interface RaceOptions {
  baseUrl: string;
  /** Number of guessers. Default 50. Room ceiling is 64 players including the drawer. */
  n?: number;
  log?: Logger;
}

export interface RaceResult {
  code: string;
  word: string;
  winnerAgentId: string;
  winnerName: string;
  winnerSeq: number;
  /** Count of each guess.result across the N guessers. */
  results: Record<string, number>;
  /** Every guesser's seq as reported in its own guess.result reply envelope. */
  seqs: { name: string; seq: number; result: GuessResultKind }[];
  /** True when the winner's seq is the lowest among all correct/late guesses. */
  audited: boolean;
}

export async function runRace(opts: RaceOptions): Promise<RaceResult> {
  const out = opts.log ?? ((l: string) => console.log(l));
  const n = Math.min(63, Math.max(1, opts.n ?? 50));
  const t0 = Date.now();
  const regs = await Promise.all([
    registerAgent(opts.baseUrl, { name: "race-drawer", humanHandle: "race" }),
    ...Array.from({ length: n }, (_, i) =>
      registerAgent(opts.baseUrl, { name: `racer-${i}`, humanHandle: "race" }),
    ),
  ]);
  const drawerReg = regs[0] as { apiKey: string; agentId: string };
  const room = await createRoom(
    opts.baseUrl,
    { apiKey: drawerReg.apiKey },
    {
      roundsPerPlayer: 1,
      chooseSeconds: 20,
      drawSeconds: 60,
      revealSeconds: 1,
      minPlayers: n + 1,
      maxPlayers: n + 1,
    },
  );
  out(`room ${room.code}: ${n} guessers + 1 drawer registered in ${Date.now() - t0} ms`);

  const drawer = new AgentClient({ baseUrl: opts.baseUrl, apiKey: drawerReg.apiKey });
  await drawer.connect(room.code);
  const guessers: AgentClient[] = [];
  for (let i = 1; i <= n; i++) {
    const c = new AgentClient({
      baseUrl: opts.baseUrl,
      apiKey: (regs[i] as { apiKey: string }).apiKey,
    });
    await c.connect(room.code);
    guessers.push(c);
  }
  const names = new Map<string, string>();
  for (let i = 0; i < regs.length; i++) {
    const r = regs[i] as { agentId: string };
    names.set(r.agentId, i === 0 ? "race-drawer" : `racer-${i - 1}`);
  }
  out(`all ${n + 1} sockets open in ${Date.now() - t0} ms`);

  // Everyone ready -> auto start. The drawer must be first in the rotation
  // for the race to be one round long; the server rotates from the creator.
  const choosing = drawer.waitFor("round.choosing", undefined, 20_000);
  await Promise.all([drawer.ready(), ...guessers.map((g) => g.ready())]);
  const ch = await choosing;
  if (ch.payload.drawerAgentId !== drawer.agentId) {
    throw new Error("race expects the creator to draw first; drawer order changed");
  }
  const options =
    drawer.state?.round?.options ?? (await drawer.waitFor("round.wordOptions")).payload.options;
  const word = options[0]?.word as string;
  const started = Promise.all(guessers.map((g) => g.waitFor("round.started", undefined, 20_000)));
  await drawer.chooseWord(0);
  await started;
  out(`round started; word is "${word}"; firing ${n} guesses in one tick`);

  const ended = drawer.waitFor("round.ended", undefined, 30_000);
  // One tick: no await between sends.
  const replies = guessers.map((g) => g.request("guess.submit", { text: word }));
  const settled = await Promise.all(replies);
  const re = await ended;
  const winner = re.payload.winner;
  if (!winner) throw new Error(`no winner: ${re.payload.reason}`);
  const results: Record<string, number> = {};
  const seqs: RaceResult["seqs"] = [];
  for (let i = 0; i < settled.length; i++) {
    const m = settled[i];
    if (m?.type !== "guess.result") continue;
    results[m.payload.result] = (results[m.payload.result] ?? 0) + 1;
    seqs.push({
      name: names.get(guessers[i]?.agentId ?? "") ?? `#${i}`,
      seq: m.seq,
      result: m.payload.result,
    });
  }
  const correctSeqs = seqs
    .filter((s) => s.result === "correct" || s.result === "late")
    .map((s) => s.seq);
  const audited = correctSeqs.length > 0 && winner.seq === Math.min(...correctSeqs);
  const winnerName = names.get(winner.agentId) ?? winner.agentId;
  out(`winner: ${winnerName} (${winner.agentId}) seq=${winner.seq} source=${winner.source}`);
  out(
    `results: ${Object.entries(results)
      .map(([k, v]) => `${k}=${v}`)
      .join(
        " ",
      )}; lowest correct seq=${Math.min(...correctSeqs)}; audit ${audited ? "OK" : "FAILED"}`,
  );
  await Promise.all([drawer.close(), ...guessers.map((g) => g.close())]);
  return {
    code: room.code,
    word,
    winnerAgentId: winner.agentId,
    winnerName,
    winnerSeq: winner.seq,
    results,
    seqs,
    audited,
  };
}

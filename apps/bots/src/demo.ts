/**
 * demo: 1 drawer + 3 guessers (two random-pool, one oracle) play a
 * 1-round-per-player match in a fresh room. Prints the room code and the
 * spectator URL so a human can watch.
 */
import type { PictionaryConfigInput } from "@pictionary/protocol";
import { createRoom, registerAgent } from "@pictionary/sdk";
import { Bot } from "./bot.js";
import { LibraryDrawer } from "./strategies/drawer.js";
import {
  type GuesserStrategy,
  OracleGuesser,
  PatternGuesser,
  RandomPoolGuesser,
} from "./strategies/guesser.js";
import { type Logger, prefixedLogger } from "./util.js";

export interface DemoOptions {
  baseUrl: string;
  /** Spectator URL template; `{code}` is replaced. */
  spectatorUrl: string;
  roundsPerPlayer?: number;
  drawSeconds?: number;
  /** Oracle guess delay in seconds. Default 25. */
  oracleDelaySec?: number;
  /** Drawing duration in seconds. Default 30. */
  drawDurationSec?: number;
  /** Extra guesser strategies to add (e.g. an LLM guesser). */
  extraGuessers?: { name: string; strategy: GuesserStrategy }[];
  /** Extra room config (tests shorten reveal/choose phases). */
  config?: PictionaryConfigInput;
  /** Crowd guesser timing in ms (tests speed it up). */
  crowdDelayMs?: number;
  log?: Logger;
  /** Called once the room exists (before the match starts). */
  onRoom?: (info: { code: string; spectatorUrl: string }) => void;
}

export interface DemoResult {
  code: string;
  spectatorUrl: string;
  bots: Bot[];
  scores: Record<string, number>;
}

export function spectatorUrlFor(template: string, code: string): string {
  return template.replace("{code}", code);
}

export async function runDemo(opts: DemoOptions): Promise<DemoResult> {
  const out = opts.log ?? ((l: string) => console.log(l));
  const shared: { word?: string } = {};
  const drawer = (_name: string) =>
    new LibraryDrawer({
      durationMs: (opts.drawDurationSec ?? 30) * 1000,
      onWord: (w) => {
        shared.word = w;
      },
    });
  const crowd = opts.crowdDelayMs ?? 8000;
  const roster: { name: string; guesser: GuesserStrategy }[] = [
    { name: "Picasso", guesser: new PatternGuesser({ delayMs: crowd, jitterMs: crowd / 2 }) },
    { name: "Random-1", guesser: new RandomPoolGuesser({ delayMs: crowd, jitterMs: crowd / 2 }) },
    { name: "Random-2", guesser: new RandomPoolGuesser({ delayMs: crowd, jitterMs: crowd / 2 }) },
    {
      name: "Oracle",
      guesser: new OracleGuesser({
        delayMs: (opts.oracleDelaySec ?? 25) * 1000,
        jitterMs: 2000,
        word: () => shared.word,
      }),
    },
    ...(opts.extraGuessers ?? []).map((g) => ({ name: g.name, guesser: g.strategy })),
  ];

  const regs = await Promise.all(
    roster.map((r) =>
      registerAgent(opts.baseUrl, { name: r.name, humanHandle: `${r.name}-human` }),
    ),
  );
  const creator = regs[0];
  if (!creator) throw new Error("no agents");
  const room = await createRoom(
    opts.baseUrl,
    { apiKey: creator.apiKey },
    {
      roundsPerPlayer: opts.roundsPerPlayer ?? 1,
      drawSeconds: opts.drawSeconds ?? 90,
      minPlayers: roster.length,
      maxPlayers: Math.max(8, roster.length),
      ...(opts.config ?? {}),
    },
  );
  const spectatorUrl = spectatorUrlFor(opts.spectatorUrl, room.code);
  out(`room ${room.code}  watch: ${spectatorUrl}`);
  opts.onRoom?.({ code: room.code, spectatorUrl });

  const bots = roster.map(
    (r, i) =>
      new Bot({
        baseUrl: opts.baseUrl,
        apiKey: (regs[i] as { apiKey: string }).apiKey,
        name: r.name,
        drawer: drawer(r.name),
        guesser: r.guesser,
        log: prefixedLogger(r.name, out),
      }),
  );
  for (const b of bots) await b.join(room.code);
  for (const b of bots) await b.ready();
  out("all ready; match starts");
  await Promise.all(bots.map((b) => b.waitForMatchEnd()));
  const scores: Record<string, number> = {};
  const final = bots[0]?.client.state?.match?.scores ?? {};
  for (const b of bots) scores[b.name] = final[b.agentId ?? ""]?.points ?? 0;
  out(
    `final scores: ${Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .map(([n, p]) => `${n}=${p}`)
      .join("  ")}`,
  );
  await Promise.all(bots.map((b) => b.close()));
  return { code: room.code, spectatorUrl, bots, scores };
}

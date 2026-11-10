/**
 * Guesser strategies. Each runs for one round and must respect the guess
 * budget (the context's `guess()` stops at 0 remaining) and the abort signal.
 */
import { WORD_POOL } from "@pictionary/engine";
import { normalizeGuess, wordPattern } from "@pictionary/protocol";
import type { AgentClient, GuessResult } from "@pictionary/sdk";
import { jittered, pick, sleep } from "../util.js";

export interface GuessContext {
  client: AgentClient;
  /** e.g. "___ _____" */
  pattern: string;
  /** Normalized guesses already sent this round. */
  tried: Set<string>;
  /** Submit one guess. Resolves undefined when out of guesses or the round is over. */
  guess(text: string): Promise<GuessResult | undefined>;
  log(line: string): void;
}

export interface GuesserStrategy {
  readonly name: string;
  run(ctx: GuessContext, signal: AbortSignal): Promise<void>;
}

export const POOL_WORDS: readonly string[] = WORD_POOL.map((w) => w.word);

/** Pool words whose pattern (word count and letter counts) matches. */
export function wordsMatchingPattern(
  pattern: string,
  pool: readonly string[] = POOL_WORDS,
): string[] {
  return pool.filter((w) => wordPattern(w) === pattern);
}

export interface TimingOptions {
  /** Mean delay before each guess in ms. */
  delayMs?: number;
  /** +/- jitter in ms. */
  jitterMs?: number;
  rng?: () => number;
}

async function guessLoop(
  ctx: GuessContext,
  signal: AbortSignal,
  candidates: () => string[],
  timing: TimingOptions,
): Promise<void> {
  const rng = timing.rng ?? Math.random;
  while (!signal.aborted && ctx.client.guessesRemaining() > 0) {
    await sleep(jittered(timing.delayMs ?? 6000, timing.jitterMs ?? 3000, rng), signal);
    if (signal.aborted) return;
    const options = candidates().filter((w) => !ctx.tried.has(normalizeGuess(w)));
    const word = pick(options, rng);
    if (!word) return;
    const r = await ctx.guess(word);
    if (!r || r.result === "correct" || r.result === "late" || r.result === "round_over") return;
  }
}

/** Random pool words with jitter. Loses almost always; good crowd filler. */
export class RandomPoolGuesser implements GuesserStrategy {
  readonly name = "random-pool";
  constructor(private readonly timing: TimingOptions = {}) {}
  run(ctx: GuessContext, signal: AbortSignal): Promise<void> {
    return guessLoop(ctx, signal, () => [...POOL_WORDS], this.timing);
  }
}

/** Pool words that fit the `wordPattern`. Smarter crowd filler. */
export class PatternGuesser implements GuesserStrategy {
  readonly name = "pattern";
  constructor(private readonly timing: TimingOptions = {}) {}
  run(ctx: GuessContext, signal: AbortSignal): Promise<void> {
    return guessLoop(
      ctx,
      signal,
      () => {
        const fit = wordsMatchingPattern(ctx.pattern);
        return fit.length > 0 ? fit : [...POOL_WORDS];
      },
      this.timing,
    );
  }
}

export interface OracleOptions extends TimingOptions {
  /** Where the word comes from: an in-process channel or the AP_ORACLE_WORD env var. */
  word: () => string | undefined;
}

/**
 * Knows the word (test/demo only) and submits it after `delayMs` +/- jitter.
 * Falls back to pattern guessing when no word is available.
 */
export class OracleGuesser implements GuesserStrategy {
  readonly name = "oracle";
  constructor(private readonly opts: OracleOptions) {}
  async run(ctx: GuessContext, signal: AbortSignal): Promise<void> {
    await sleep(
      jittered(this.opts.delayMs ?? 25_000, this.opts.jitterMs ?? 2_000, this.opts.rng),
      signal,
    );
    if (signal.aborted) return;
    const word = this.opts.word();
    if (!word) {
      ctx.log("oracle has no word; falling back to pattern guesses");
      return new PatternGuesser({ delayMs: 1000, jitterMs: 500 }).run(ctx, signal);
    }
    await ctx.guess(word);
  }
}

export function oracleWordFromEnv(env = process.env): () => string | undefined {
  return () => env.AP_ORACLE_WORD;
}

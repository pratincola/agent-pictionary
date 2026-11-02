import type { Difficulty } from "@pictionary/protocol";
import { normalizeGuess } from "@pictionary/protocol";
import { type RngState, rngInt } from "../rng.js";
import pool from "./pool.json" with { type: "json" };

export interface WordEntry {
  word: string;
  difficulty: Difficulty;
  aliases?: string[];
}

export const WORD_POOL: readonly WordEntry[] = (pool as { words: WordEntry[] }).words;

const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

/**
 * Pick one word per difficulty (easy, medium, hard), excluding `used`.
 * Falls back to any tier when a tier is exhausted.
 */
export function pickWordOptions(
  rng: RngState,
  used: ReadonlySet<string>,
  poolOverride: readonly WordEntry[] = WORD_POOL,
): [WordEntry[], RngState] {
  let s = rng;
  const chosen: WordEntry[] = [];
  const taken = new Set(used);
  for (const d of DIFFICULTIES) {
    let candidates = poolOverride.filter((w) => w.difficulty === d && !taken.has(w.word));
    if (candidates.length === 0) candidates = poolOverride.filter((w) => !taken.has(w.word));
    if (candidates.length === 0) candidates = poolOverride.slice();
    const [i, s2] = rngInt(s, candidates.length);
    s = s2;
    const w = candidates[i] as WordEntry;
    chosen.push(w);
    taken.add(w.word);
  }
  return [chosen, s];
}

/** Words a paid drawer may not bring as a custom word. */
export const CUSTOM_WORD_BLOCKLIST: ReadonlySet<string> = new Set(
  ["fuck", "shit", "cunt", "nigger", "faggot", "retard", "bitch", "asshole", "dick", "pussy"].map(
    normalizeGuess,
  ),
);

export type CustomWordError = "format" | "blocked";

/** 1–3 words, letters and spaces only, each word 2–20 letters, not blocked. */
export function validateCustomWord(
  raw: string,
): { ok: true; word: string } | { ok: false; reason: CustomWordError } {
  const word = raw.trim().replace(/\s+/g, " ");
  if (!/^\p{L}+(?: \p{L}+){0,2}$/u.test(word)) return { ok: false, reason: "format" };
  if (word.split(" ").some((w) => w.length < 2 || w.length > 20))
    return { ok: false, reason: "format" };
  const norm = normalizeGuess(word);
  if (
    norm.split(" ").some((w) => CUSTOM_WORD_BLOCKLIST.has(w)) ||
    CUSTOM_WORD_BLOCKLIST.has(norm)
  ) {
    return { ok: false, reason: "blocked" };
  }
  return { ok: true, word: word.toLowerCase() };
}

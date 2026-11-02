/**
 * Guess normalization (PROTOCOL.md "Guess normalization").
 *
 * 1. Unicode NFKC, lowercase, trim.
 * 2. Remove everything but letters, digits, spaces.
 * 3. Collapse spaces. Drop a leading "a ", "an ", "the ".
 */
export function normalizeGuess(text: string): string {
  let s = text.normalize("NFKC").toLowerCase().trim();
  // Keep letters and digits from any script plus spaces; delete the rest.
  // "ice-cream" -> "icecream" (a "close" match for "ice cream"; add an alias
  // to the word pool when the hyphenated form must count as correct).
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:a|an|the) /, "");
  return s;
}

/** Classic Levenshtein edit distance over code points. */
export function levenshtein(a: string, b: string): number {
  const s = Array.from(a);
  const t = Array.from(b);
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  let prev = new Array<number>(t.length + 1);
  let cur = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[t.length] ?? 0;
}

export type MatchResult = "correct" | "close" | "incorrect";

/**
 * Compare a raw guess against the secret word and its aliases.
 * `correct` on exact normalized match; `close` when Levenshtein <= 1 to any.
 */
export function matchGuess(
  guess: string,
  word: string,
  aliases: readonly string[] = [],
): MatchResult {
  const g = normalizeGuess(guess);
  if (g.length === 0) return "incorrect";
  const targets = [word, ...aliases].map(normalizeGuess);
  if (targets.includes(g)) return "correct";
  if (targets.some((t) => levenshtein(g, t) <= 1)) return "close";
  return "incorrect";
}

/** "ice cream" -> "___ _____" (underscore per letter, space kept). */
export function wordPattern(word: string): string {
  return normalizeGuess(word)
    .split(" ")
    .map((w) => "_".repeat(Array.from(w).length))
    .join(" ");
}

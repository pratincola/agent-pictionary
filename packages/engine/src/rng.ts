/**
 * Pure, seedable RNG. State is a plain number so it can live inside the
 * immutable engine state and be replayed. mulberry32.
 */
export type RngState = number;

export function rngSeed(seed: number): RngState {
  return seed >>> 0;
}

/** Returns a float in [0, 1) and the next state. */
export function rngNext(state: RngState): [number, RngState] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Integer in [0, n). */
export function rngInt(state: RngState, n: number): [number, RngState] {
  const [v, s] = rngNext(state);
  return [Math.floor(v * n), s];
}

/** Fisher–Yates shuffle, returns a new array and the next state. */
export function rngShuffle<T>(state: RngState, items: readonly T[]): [T[], RngState] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, s2] = rngInt(s, i + 1);
    s = s2;
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return [out, s];
}

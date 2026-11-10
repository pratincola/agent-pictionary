/** Sleep that resolves early (without throwing) when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Uniform random in [base - jitter, base + jitter], never below 0. */
export function jittered(base: number, jitter: number, rng: () => number = Math.random): number {
  return Math.max(0, base + (rng() * 2 - 1) * jitter);
}

export function pick<T>(items: readonly T[], rng: () => number = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

/** Small deterministic RNG (mulberry32) for reproducible bot runs. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Logger = (line: string) => void;

export function prefixedLogger(prefix: string, out: Logger = (l) => console.log(l)): Logger {
  return (line) => out(`[${prefix}] ${line}`);
}

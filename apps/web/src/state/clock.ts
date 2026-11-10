/**
 * Server clock estimation. Every server message carries `ts` (server wall
 * clock when it was sent). `ts - localArrival` equals the true clock offset
 * minus one-way latency, so the largest recent sample is the best estimate:
 * it is the one with the least latency. A sliding window lets the estimate
 * follow drift and the server restarting on a different clock.
 */
export interface ClockState {
  readonly samples: readonly number[];
  readonly windowSize: number;
}

export const DEFAULT_CLOCK_WINDOW = 32;

export function initialClock(windowSize = DEFAULT_CLOCK_WINDOW): ClockState {
  return { samples: [], windowSize };
}

/** Record one `(serverTs, localNow)` observation. */
export function observe(state: ClockState, serverTs: number, localNow: number): ClockState {
  const sample = serverTs - localNow;
  const samples = [...state.samples, sample];
  if (samples.length > state.windowSize) samples.splice(0, samples.length - state.windowSize);
  return { ...state, samples };
}

/** Estimated `serverTime - localTime` in ms. 0 before the first sample. */
export function offsetMs(state: ClockState): number {
  if (state.samples.length === 0) return 0;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of state.samples) if (s > max) max = s;
  return max;
}

export function serverNow(state: ClockState, localNow: number): number {
  return localNow + offsetMs(state);
}

/** Milliseconds until an absolute server-time `deadline`, never negative. */
export function remainingMs(state: ClockState, deadline: number, localNow: number): number {
  return Math.max(0, deadline - serverNow(state, localNow));
}

/** "m:ss" for the big header countdown; whole seconds, rounded up so 0:00 means expired. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

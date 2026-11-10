import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  initialClock,
  observe,
  offsetMs,
  remainingMs,
  serverNow,
} from "../src/state/clock.js";

describe("server clock offset", () => {
  it("is zero before any sample", () => {
    expect(offsetMs(initialClock())).toBe(0);
    expect(remainingMs(initialClock(), 10_000, 4_000)).toBe(6_000);
  });

  it("takes the largest sample (least latency) as the offset", () => {
    // Server is 5 s ahead. Messages arrive 20..120 ms after being stamped.
    let c = initialClock();
    const trueOffset = 5_000;
    for (const latency of [120, 60, 20, 90]) {
      const local = 1_000_000 + latency;
      c = observe(c, local - latency + trueOffset, local);
    }
    expect(offsetMs(c)).toBe(trueOffset - 20);
    expect(serverNow(c, 2_000_000)).toBe(2_000_000 + trueOffset - 20);
  });

  it("works when the local clock is ahead of the server", () => {
    let c = initialClock();
    c = observe(c, 100_000, 103_000);
    expect(offsetMs(c)).toBe(-3_000);
    expect(remainingMs(c, 110_000, 103_000)).toBe(10_000);
  });

  it("slides the window so a server restart on a different clock is followed", () => {
    let c = initialClock(4);
    for (let i = 0; i < 4; i++) c = observe(c, 50_000 + i, 40_000 + i);
    expect(offsetMs(c)).toBe(10_000);
    for (let i = 0; i < 4; i++) c = observe(c, 41_000 + i, 40_100 + i);
    expect(c.samples).toHaveLength(4);
    expect(offsetMs(c)).toBe(900);
  });

  it("never reports a negative remaining time", () => {
    const c = observe(initialClock(), 1_000, 1_000);
    expect(remainingMs(c, 500, 1_000)).toBe(0);
  });

  it("formats m:ss rounding up partial seconds", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(59_999)).toBe("1:00");
    expect(formatCountdown(90_000)).toBe("1:30");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});

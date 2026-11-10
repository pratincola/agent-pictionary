import { describe, expect, it } from "vitest";
import {
  autoscrollReducer,
  initialAutoscroll,
  isNearBottom,
  shouldScrollOnAppend,
} from "../src/state/autoscroll.js";

describe("feed autoscroll", () => {
  it("follows new items while the user is at the bottom", () => {
    expect(shouldScrollOnAppend(initialAutoscroll)).toBe(true);
    const s = autoscrollReducer(initialAutoscroll, {
      type: "scroll",
      metrics: { scrollTop: 900, scrollHeight: 1_200, clientHeight: 300 },
    });
    expect(s.following).toBe(true);
    expect(autoscrollReducer(s, { type: "append" })).toBe(s);
  });

  it("stops following when the user scrolls up", () => {
    const s = autoscrollReducer(initialAutoscroll, {
      type: "scroll",
      metrics: { scrollTop: 100, scrollHeight: 1_200, clientHeight: 300 },
    });
    expect(s.following).toBe(false);
    expect(shouldScrollOnAppend(s)).toBe(false);
  });

  it("resumes when the user scrolls back near the bottom", () => {
    let s = autoscrollReducer(initialAutoscroll, {
      type: "scroll",
      metrics: { scrollTop: 0, scrollHeight: 1_200, clientHeight: 300 },
    });
    s = autoscrollReducer(s, {
      type: "scroll",
      metrics: { scrollTop: 880, scrollHeight: 1_200, clientHeight: 300 },
    });
    expect(s.following).toBe(true);
  });

  it("treats a small slack as still at the bottom", () => {
    expect(isNearBottom({ scrollTop: 876, scrollHeight: 1_200, clientHeight: 300 })).toBe(true);
    expect(isNearBottom({ scrollTop: 875, scrollHeight: 1_200, clientHeight: 300 })).toBe(false);
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 })).toBe(true);
  });

  it("reset re-pins (new round)", () => {
    const up = autoscrollReducer(initialAutoscroll, {
      type: "scroll",
      metrics: { scrollTop: 0, scrollHeight: 1_200, clientHeight: 300 },
    });
    expect(autoscrollReducer(up, { type: "reset" }).following).toBe(true);
  });
});

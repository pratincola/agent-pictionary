import type { DrawOp, OpLogEntry } from "@pictionary/protocol";
import { describe, expect, it } from "vitest";
import { emptyOpLog, hasGap, lastOpSeq, opLogReducer, visibleOps } from "../src/state/opLog.js";

const line = (n: number): DrawOp => ({
  kind: "line",
  from: [n, n],
  to: [n + 10, n + 10],
  width: 2,
  color: "#000000",
});
const entry = (opSeq: number, erased?: boolean): OpLogEntry => ({
  opSeq,
  op: line(opSeq),
  ...(erased ? { erased: true } : {}),
});

describe("op log reducer", () => {
  it("appends live ops without bumping the generation", () => {
    let s = opLogReducer(emptyOpLog, { type: "op", opSeq: 1, op: line(1) });
    s = opLogReducer(s, { type: "op", opSeq: 2, op: line(2) });
    expect(s.ops.map((e) => e.opSeq)).toEqual([1, 2]);
    expect(s.generation).toBe(0);
    expect(visibleOps(s)).toHaveLength(2);
    expect(lastOpSeq(s)).toBe(2);
  });

  it("ignores a duplicate op", () => {
    const a = opLogReducer(emptyOpLog, { type: "op", opSeq: 1, op: line(1) });
    const b = opLogReducer(a, { type: "op", opSeq: 1, op: line(1) });
    expect(b).toBe(a);
  });

  it("inserts a late op in order and forces a repaint", () => {
    let s = opLogReducer(emptyOpLog, { type: "op", opSeq: 1, op: line(1) });
    s = opLogReducer(s, { type: "op", opSeq: 3, op: line(3) });
    expect(hasGap(s, 5)).toBe(true);
    expect(hasGap(s, 4)).toBe(false);
    const g = s.generation;
    s = opLogReducer(s, { type: "op", opSeq: 2, op: line(2) });
    expect(s.ops.map((e) => e.opSeq)).toEqual([1, 2, 3]);
    expect(s.generation).toBe(g + 1);
  });

  it("erase hides one op and keeps opSeq contiguous", () => {
    let s = emptyOpLog;
    for (let i = 1; i <= 4; i++) s = opLogReducer(s, { type: "op", opSeq: i, op: line(i) });
    const g = s.generation;
    s = opLogReducer(s, { type: "erased", opSeq: 2 });
    expect(s.ops).toHaveLength(4);
    expect(s.ops[1]?.erased).toBe(true);
    expect(visibleOps(s).map((o) => (o as { from: [number, number] }).from[0])).toEqual([1, 3, 4]);
    expect(s.generation).toBe(g + 1);
    // Erasing again or erasing an unknown op is a no-op.
    expect(opLogReducer(s, { type: "erased", opSeq: 2 })).toBe(s);
    expect(opLogReducer(s, { type: "erased", opSeq: 99 })).toBe(s);
  });

  it("clear hides everything; later ops still render", () => {
    let s = emptyOpLog;
    for (let i = 1; i <= 3; i++) s = opLogReducer(s, { type: "op", opSeq: i, op: line(i) });
    s = opLogReducer(s, { type: "cleared" });
    expect(visibleOps(s)).toHaveLength(0);
    expect(lastOpSeq(s)).toBe(3);
    s = opLogReducer(s, { type: "op", opSeq: 4, op: line(4) });
    expect(visibleOps(s)).toHaveLength(1);
    expect(opLogReducer(s, { type: "cleared" }).generation).toBe(s.generation + 1);
  });

  it("snapshot resync replaces the log and honours erased flags", () => {
    let s = emptyOpLog;
    for (let i = 1; i <= 2; i++) s = opLogReducer(s, { type: "op", opSeq: i, op: line(i) });
    const g = s.generation;
    s = opLogReducer(s, { type: "snapshot", ops: [entry(3), entry(1, true), entry(2)] });
    expect(s.ops.map((e) => e.opSeq)).toEqual([1, 2, 3]);
    expect(visibleOps(s)).toHaveLength(2);
    expect(s.generation).toBe(g + 1);
  });

  it("reset empties the log for a new round", () => {
    const s = opLogReducer(emptyOpLog, { type: "op", opSeq: 1, op: line(1) });
    const r = opLogReducer(s, { type: "reset" });
    expect(r.ops).toHaveLength(0);
    expect(r.generation).toBe(s.generation + 1);
  });

  it("merge fills a gap from GET /ops without a repaint when append-only", () => {
    let s = opLogReducer(emptyOpLog, { type: "op", opSeq: 1, op: line(1) });
    const g = s.generation;
    s = opLogReducer(s, { type: "merge", ops: [entry(2), entry(3)] });
    expect(s.ops.map((e) => e.opSeq)).toEqual([1, 2, 3]);
    expect(s.generation).toBe(g);
    // Merging a hole in the middle repaints.
    s = opLogReducer(s, { type: "op", opSeq: 6, op: line(6) });
    s = opLogReducer(s, { type: "merge", ops: [entry(4), entry(5), entry(6)] });
    expect(s.ops.map((e) => e.opSeq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.generation).toBe(g + 1);
    expect(opLogReducer(s, { type: "merge", ops: [entry(6)] })).toBe(s);
  });
});

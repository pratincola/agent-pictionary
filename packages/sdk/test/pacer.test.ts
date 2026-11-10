import type { DrawOp } from "@pictionary/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolError } from "../src/errors.js";
import { DrawQueue, Pacer } from "../src/pacer.js";

const op = (i: number): DrawOp => ({
  kind: "line",
  from: [0, 0],
  to: [i % 1000, 1],
  width: 2,
  color: "#000000",
});
const ops = (n: number) => Array.from({ length: n }, (_, i) => op(i));

/** Server-side bucket, copied from apps/server/src/ws.ts, to judge our pacing. */
class ServerBucket {
  tokens: number;
  last: number;
  rejected = 0;
  constructor(
    private readonly rate: number,
    private readonly now: () => number,
  ) {
    this.tokens = rate;
    this.last = now();
  }
  take(n: number): boolean {
    const t = this.now();
    this.tokens = Math.min(this.rate, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens + 1e-9 >= n) {
      this.tokens -= n;
      return true;
    }
    this.rejected += 1;
    return false;
  }
}

describe("Pacer", () => {
  it("starts with burst minus reserve and refills at the rate", () => {
    let t = 0;
    const p = new Pacer({ now: () => t, reserve: 2 });
    expect(p.available()).toBe(28);
    expect(p.waitMs(28)).toBe(0);
    p.take(28);
    expect(p.waitMs(1)).toBe(34); // ceil(1/30 s)
    expect(p.waitMs(20)).toBe(667);
    t = 1000;
    expect(p.available()).toBe(28); // capped at burst - reserve
    p.penalize();
    expect(p.available()).toBe(0);
    p.reset();
    expect(p.available()).toBe(28);
  });
});

describe("DrawQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("splits into <= 20 ops per message and never trips the server bucket", async () => {
    const now = () => Date.now();
    const server = new ServerBucket(30, now);
    const sent: number[] = [];
    let next = 1;
    let lastSendAt = 0;
    const q = new DrawQueue(
      async (batch) => {
        if (!server.take(batch.length)) throw new ProtocolError("RATE_LIMITED", "limited");
        sent.push(batch.length);
        lastSendAt = Date.now();
        const from = next;
        next += batch.length;
        return { opSeqFrom: from, opSeqTo: next - 1 };
      },
      { now },
    );
    const start = Date.now();
    const done = q.enqueue(ops(300));
    await vi.advanceTimersByTimeAsync(20_000);
    const r = await done;
    expect(server.rejected).toBe(0);
    expect(sent.every((n) => n <= 20)).toBe(true);
    expect(sent.reduce((a, b) => a + b, 0)).toBe(300);
    expect(r.batches).toHaveLength(15);
    expect(r.opSeqFrom).toBe(1);
    expect(r.opSeqTo).toBe(300);
    // 300 ops at 30/s with a 28-op head start: about 9 s.
    const elapsed = lastSendAt - start;
    expect(elapsed).toBeGreaterThan(8_500);
    expect(elapsed).toBeLessThan(10_500);
  });

  it("survives a server clock running slightly ahead (jitter) thanks to the reserve", async () => {
    // Server sees messages 60 ms "late" on odd messages: simulate by letting the
    // server bucket read a clock that is sometimes behind ours.
    let skew = 0;
    const server = new ServerBucket(30, () => Date.now() - skew);
    let i = 0;
    const q = new DrawQueue(async (batch) => {
      skew = i++ % 2 ? 60 : 0;
      if (!server.take(batch.length)) throw new ProtocolError("RATE_LIMITED", "limited");
      return { opSeqFrom: 1, opSeqTo: batch.length };
    });
    const done = q.enqueue(ops(200));
    await vi.advanceTimersByTimeAsync(15_000);
    await done;
    expect(server.rejected).toBe(0);
  });

  it("re-queues a RATE_LIMITED batch and resolves after the retry", async () => {
    let calls = 0;
    const q = new DrawQueue(async (batch) => {
      calls += 1;
      if (calls === 1) throw new ProtocolError("RATE_LIMITED", "limited");
      return { opSeqFrom: 1, opSeqTo: batch.length };
    });
    const done = q.enqueue(ops(5));
    await vi.advanceTimersByTimeAsync(2_000);
    const r = await done;
    expect(calls).toBe(2);
    expect(r.opSeqTo).toBe(5);
  });

  it("rejects queued batches on fail()", async () => {
    const q = new DrawQueue(async () => {
      await new Promise(() => {}); // never resolves
      return { opSeqFrom: 1, opSeqTo: 1 };
    });
    void q.enqueue(ops(28)); // consumes the head start
    const late = q.enqueue(ops(20)); // must wait in the queue
    expect(q.pending).toBe(20);
    q.fail(new Error("gone"));
    await expect(late).rejects.toThrow("gone");
    expect(q.pending).toBe(0);
  });

  it("empty input resolves at once", async () => {
    const q = new DrawQueue(async () => ({ opSeqFrom: 1, opSeqTo: 1 }));
    await expect(q.enqueue([])).resolves.toEqual({ batches: [], opSeqFrom: 0, opSeqTo: 0 });
  });
});

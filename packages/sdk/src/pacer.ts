/**
 * Client-side pacing for `draw.ops`.
 *
 * The server keeps a per-connection token bucket (burst 30, refill 30 ops/s)
 * and DROPS over-limit messages with `RATE_LIMITED`. We mirror that bucket
 * here, hold back a small reserve for clock/network jitter, and split long op
 * lists into messages of at most 20 ops (`MAX_OPS_PER_MESSAGE`).
 */
import { type DrawOp, MAX_OPS_PER_MESSAGE, MAX_OPS_PER_SECOND } from "@pictionary/protocol";
import { ProtocolError } from "./errors.js";

export interface PacerOptions {
  /** Server refill rate (ops per second). Default 30. */
  ratePerSec?: number;
  /** Server burst (bucket size). Default 30. */
  burst?: number;
  /** Tokens we never spend, to absorb jitter between our clock and the server's. Default 2. */
  reserve?: number;
  /** Ops per `draw.ops` message. Default 20 (protocol max). */
  maxOpsPerMessage?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export class Pacer {
  readonly rate: number;
  readonly burst: number;
  readonly reserve: number;
  readonly maxOpsPerMessage: number;
  private tokens: number;
  private last: number;
  private readonly now: () => number;

  constructor(opts: PacerOptions = {}) {
    this.rate = opts.ratePerSec ?? MAX_OPS_PER_SECOND;
    this.burst = opts.burst ?? MAX_OPS_PER_SECOND;
    this.reserve = Math.min(opts.reserve ?? 2, this.burst - 1);
    this.maxOpsPerMessage = Math.min(
      opts.maxOpsPerMessage ?? MAX_OPS_PER_MESSAGE,
      MAX_OPS_PER_MESSAGE,
    );
    this.now = opts.now ?? Date.now;
    this.tokens = this.burst;
    this.last = this.now();
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
  }

  /** Tokens available to spend right now (after the reserve). */
  available(): number {
    this.refill();
    return Math.max(0, this.tokens - this.reserve);
  }

  /** Milliseconds until `n` ops may be sent (0 when they may go now). */
  waitMs(n: number): number {
    const avail = this.available();
    if (avail >= n) return 0;
    return Math.ceil(((n - avail) / this.rate) * 1000);
  }

  /** Spend `n` tokens. Call right before sending. */
  take(n: number): void {
    this.refill();
    this.tokens = Math.max(0, this.tokens - n);
  }

  /** The server reported RATE_LIMITED: assume its bucket is empty. */
  penalize(): void {
    this.refill();
    this.tokens = 0;
  }

  /** A new connection has a full bucket on the server. */
  reset(): void {
    this.tokens = this.burst;
    this.last = this.now();
  }
}

export interface AckRange {
  opSeqFrom: number;
  opSeqTo: number;
}

export interface DrawResult {
  /** One range per `draw.ops` message, in send order. */
  batches: AckRange[];
  /** Lowest / highest opSeq across all batches. */
  opSeqFrom: number;
  opSeqTo: number;
}

interface Batch {
  ops: DrawOp[];
  attempts: number;
  resolve: (r: AckRange) => void;
  reject: (e: unknown) => void;
}

export interface DrawQueueOptions extends PacerOptions {
  /** Retries per batch after RATE_LIMITED before giving up. Default 5. */
  maxRetries?: number;
  /** Sleep, injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Serializes paced `draw.ops` sends. `send` performs one message and resolves
 * with the ack range or rejects with a `ProtocolError`. Messages are fired
 * without waiting for the previous ack (throughput); a `RATE_LIMITED` reply
 * re-queues that batch at the front after draining the local bucket.
 */
export class DrawQueue {
  readonly pacer: Pacer;
  private readonly queue: Batch[] = [];
  private draining = false;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly send: (ops: DrawOp[]) => Promise<AckRange>,
    opts: DrawQueueOptions = {},
  ) {
    this.pacer = new Pacer(opts);
    this.maxRetries = opts.maxRetries ?? 5;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get pending(): number {
    return this.queue.reduce((n, b) => n + b.ops.length, 0);
  }

  /** Queue ops; resolves when every batch has been acked. */
  enqueue(ops: readonly DrawOp[]): Promise<DrawResult> {
    if (ops.length === 0) return Promise.resolve({ batches: [], opSeqFrom: 0, opSeqTo: 0 });
    const promises: Promise<AckRange>[] = [];
    for (let i = 0; i < ops.length; i += this.pacer.maxOpsPerMessage) {
      const slice = ops.slice(i, i + this.pacer.maxOpsPerMessage);
      promises.push(
        new Promise<AckRange>((resolve, reject) => {
          this.queue.push({ ops: slice, attempts: 0, resolve, reject });
        }),
      );
    }
    this.kick();
    return Promise.all(promises).then((batches) => ({
      batches,
      opSeqFrom: Math.min(...batches.map((b) => b.opSeqFrom)),
      opSeqTo: Math.max(...batches.map((b) => b.opSeqTo)),
    }));
  }

  /** Reject everything still queued (socket gone for good). */
  fail(err: unknown): void {
    for (const b of this.queue.splice(0)) b.reject(err);
  }

  /** New connection: the server bucket is full again. */
  reset(): void {
    this.pacer.reset();
  }

  private kick(): void {
    if (!this.draining) void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue[0] as Batch;
        const wait = this.pacer.waitMs(batch.ops.length);
        if (wait > 0) {
          await this.sleep(wait);
          continue; // re-evaluate: queue may have been failed/reset meanwhile
        }
        this.queue.shift();
        this.pacer.take(batch.ops.length);
        batch.attempts += 1;
        void this.send(batch.ops).then(
          (r) => batch.resolve(r),
          (err: unknown) => {
            if (
              err instanceof ProtocolError &&
              err.code === "RATE_LIMITED" &&
              batch.attempts <= this.maxRetries
            ) {
              this.pacer.penalize();
              this.queue.unshift(batch);
              this.kick();
              return;
            }
            batch.reject(err);
          },
        );
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) void this.drain();
    }
  }
}

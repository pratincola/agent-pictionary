import { CANVAS_SIZE, type DrawOp } from "@pictionary/protocol";
import type { OpLogState } from "../state/opLog.js";

export const PAPER = "#fbfaf5";

/** Paint one op into a context already scaled to the 1000x1000 logical space. */
export function drawOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = op.color;
  ctx.lineWidth = op.width;
  switch (op.kind) {
    case "path": {
      const [first, ...rest] = op.points;
      if (!first) return;
      ctx.beginPath();
      if (rest.length === 0) {
        // A single point is a dot.
        ctx.fillStyle = op.color;
        ctx.arc(first[0], first[1], op.width / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.moveTo(first[0], first[1]);
      for (const [x, y] of rest) ctx.lineTo(x, y);
      ctx.stroke();
      return;
    }
    case "line":
      ctx.beginPath();
      ctx.moveTo(op.from[0], op.from[1]);
      ctx.lineTo(op.to[0], op.to[1]);
      ctx.stroke();
      return;
    case "rect":
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fillRect(op.x, op.y, op.w, op.h);
      }
      ctx.strokeRect(op.x, op.y, op.w, op.h);
      return;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, Math.PI * 2);
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fill();
      }
      ctx.stroke();
      return;
  }
}

/**
 * Incremental painter. Call `sync(opLog)` whenever the log changes; it clears
 * and repaints only when the log's generation changed (snapshot, erase,
 * clear, new round), otherwise it paints just the appended ops.
 */
export class CanvasPainter {
  private generation = -1;
  private painted = 0;
  private cssSize = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** Resize the backing store to `cssPx` square at the device pixel ratio. Forces a repaint. */
  resize(cssPx: number, dpr: number): void {
    const px = Math.max(1, Math.round(cssPx * dpr));
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this.canvas.style.width = `${cssPx}px`;
    this.canvas.style.height = `${cssPx}px`;
    this.cssSize = cssPx;
    this.dpr = dpr;
    this.generation = -1;
  }

  sync(log: OpLogState): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const scale = (this.cssSize * this.dpr) / CANVAS_SIZE;
    const full = log.generation !== this.generation || log.ops.length < this.painted;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (full) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      this.painted = 0;
      this.generation = log.generation;
    }
    for (let i = this.painted; i < log.ops.length; i++) {
      const e = log.ops[i];
      if (e && !e.erased) drawOp(ctx, e.op);
    }
    this.painted = log.ops.length;
  }
}

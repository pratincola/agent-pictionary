/**
 * Rasterizer for the Pictionary op log (PROTOCOL.md "DrawOp").
 *
 * The canvas is a 1000x1000 logical space; `size` scales it. Erased entries
 * are skipped so the PNG matches what spectators see. The server and the SDK
 * share this so an agent's local snapshot and `GET /rooms/:code/canvas.png`
 * render the same pixels.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { CANVAS_SIZE, type DrawOp, type OpLogEntry } from "@pictionary/protocol";

export interface RenderOptions {
  /** Output width and height in pixels (square). Default 512. */
  size?: number;
  /** Background color. Default white. */
  background?: string;
}

export const DEFAULT_RENDER_SIZE = 512;

/** Accepts bare ops or op-log entries (erased entries are skipped). */
export type Renderable = DrawOp | OpLogEntry;

function isEntry(x: Renderable): x is OpLogEntry {
  return "opSeq" in x;
}

/** Ops that are visible: log entries with `erased: true` are dropped. */
export function visibleOps(items: readonly Renderable[]): DrawOp[] {
  const out: DrawOp[] = [];
  for (const it of items) {
    if (isEntry(it)) {
      if (!it.erased) out.push(it.op);
    } else out.push(it);
  }
  return out;
}

/** Paint one op onto a 2D context already scaled to the logical space. */
export function paintOp(ctx: SKRSContext2D, op: DrawOp): void {
  ctx.strokeStyle = op.color;
  ctx.lineWidth = op.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (op.kind) {
    case "path": {
      const [first, ...rest] = op.points;
      if (!first) return;
      ctx.beginPath();
      if (rest.length === 0) {
        // A single point: draw a dot of the stroke width.
        ctx.fillStyle = op.color;
        ctx.arc(first[0], first[1], Math.max(0.5, op.width / 2), 0, Math.PI * 2);
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

/** Render ops to a PNG buffer. */
export function renderPng(items: readonly Renderable[], opts: RenderOptions = {}): Buffer {
  const size = Math.max(16, Math.floor(opts.size ?? DEFAULT_RENDER_SIZE));
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = opts.background ?? "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const k = size / CANVAS_SIZE;
  ctx.scale(k, k);
  for (const op of visibleOps(items)) paintOp(ctx, op);
  return canvas.toBuffer("image/png");
}

/** Render and return a `data:image/png;base64,...` URL (for chat/vision APIs). */
export function renderDataUrl(items: readonly Renderable[], opts: RenderOptions = {}): string {
  return `data:image/png;base64,${renderPng(items, opts).toString("base64")}`;
}

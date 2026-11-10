/**
 * Small geometry helpers that produce protocol DrawOps on the 1000x1000
 * canvas. Coordinates are clamped and rounded so every op passes the schema.
 */
import {
  CANVAS_SIZE,
  type DrawOp,
  type HexColor,
  type Point,
  type StrokeWidth,
} from "@pictionary/protocol";

export const INK: HexColor = "#1f2430";
export const DEFAULT_WIDTH: StrokeWidth = 4;

export interface Style {
  width?: StrokeWidth;
  color?: HexColor;
  fill?: HexColor;
}

export const c = (v: number): number => Math.max(0, Math.min(CANVAS_SIZE, Math.round(v)));
export const pt = (x: number, y: number): Point => [c(x), c(y)];

export function line(x1: number, y1: number, x2: number, y2: number, s: Style = {}): DrawOp {
  return {
    kind: "line",
    from: pt(x1, y1),
    to: pt(x2, y2),
    width: s.width ?? DEFAULT_WIDTH,
    color: s.color ?? INK,
  };
}

export function path(points: readonly (readonly [number, number])[], s: Style = {}): DrawOp {
  return {
    kind: "path",
    points: points.map(([x, y]) => pt(x, y)),
    width: s.width ?? DEFAULT_WIDTH,
    color: s.color ?? INK,
  };
}

/** Closed polygon as a path (first point repeated at the end). */
export function polygon(points: readonly (readonly [number, number])[], s: Style = {}): DrawOp {
  const first = points[0];
  return path(first ? [...points, first] : points, s);
}

export function rect(x: number, y: number, w: number, h: number, s: Style = {}): DrawOp {
  const x0 = c(x);
  const y0 = c(y);
  const op: DrawOp = {
    kind: "rect",
    x: x0,
    y: y0,
    w: Math.max(0, Math.min(CANVAS_SIZE - x0, Math.round(w))),
    h: Math.max(0, Math.min(CANVAS_SIZE - y0, Math.round(h))),
    width: s.width ?? DEFAULT_WIDTH,
    color: s.color ?? INK,
  };
  if (s.fill) op.fill = s.fill;
  return op;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, s: Style = {}): DrawOp {
  const x = c(cx);
  const y = c(cy);
  const rxx = Math.max(0, Math.min(Math.round(rx), x, CANVAS_SIZE - x));
  const ryy = Math.max(0, Math.min(Math.round(ry), y, CANVAS_SIZE - y));
  const op: DrawOp = {
    kind: "ellipse",
    cx: x,
    cy: y,
    rx: rxx,
    ry: ryy,
    width: s.width ?? DEFAULT_WIDTH,
    color: s.color ?? INK,
  };
  if (s.fill) op.fill = s.fill;
  return op;
}

export function circle(cx: number, cy: number, r: number, s: Style = {}): DrawOp {
  return ellipse(cx, cy, r, r, s);
}

/** Arc from `a0` to `a1` radians (clockwise in screen space) as a path. */
export function arc(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  s: Style = {},
  segments = 24,
): DrawOp {
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return path(pts, s);
}

/** Zig-zag between two points (grass, lightning, waves). */
export function zigzag(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  teeth: number,
  amp: number,
  s: Style = {},
): DrawOp {
  const pts: [number, number][] = [];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const steps = teeth * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const off = i % 2 === 0 ? 0 : amp;
    pts.push([x1 + dx * t + nx * off, y1 + dy * t + ny * off]);
  }
  return path(pts, s);
}

/** Sine wave between x1..x2 at baseline y. */
export function wave(
  x1: number,
  x2: number,
  y: number,
  periods: number,
  amp: number,
  s: Style = {},
) {
  const pts: [number, number][] = [];
  const n = periods * 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x1 + (x2 - x1) * t, y + Math.sin(t * periods * Math.PI * 2) * amp]);
  }
  return path(pts, s);
}

/** Regular star polygon centred at (cx, cy). */
export function star(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points = 5,
  s: Style = {},
) {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return polygon(pts, s);
}

/** Heart outline centred horizontally at cx with top of lobes at y. */
export function heart(cx: number, cy: number, size: number, s: Style = {}): DrawOp {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push([cx + (x * size) / 16, cy + (y * size) / 16]);
  }
  return path(pts, s);
}

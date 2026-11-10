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

/** Filled circle (eye, nose, button). */
export function dot(cx: number, cy: number, r: number, color: HexColor = INK): DrawOp {
  return circle(cx, cy, r, { width: 2, color, fill: color });
}

/** `n` radial lines from radius r0 to r1 (sun rays, spokes, sparkle). */
export function spokes(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  n: number,
  s: Style = {},
  phase = 0,
): DrawOp[] {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return line(
      cx + r0 * Math.cos(a),
      cy + r0 * Math.sin(a),
      cx + r1 * Math.cos(a),
      cy + r1 * Math.sin(a),
      s,
    );
  });
}

/** Dashed line as `dashes` short line ops. */
export function dashed(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashes: number,
  s: Style = {},
): DrawOp[] {
  const out: DrawOp[] = [];
  const n = dashes * 2 - 1;
  for (let i = 0; i < n; i += 2) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    out.push(
      line(x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0, x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1, s),
    );
  }
  return out;
}

/** Quadratic bezier from p0 to p1 bending toward control c. */
export function curve(
  p0: readonly [number, number],
  ctrl: readonly [number, number],
  p1: readonly [number, number],
  s: Style = {},
  segments = 16,
): DrawOp {
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    pts.push([
      u * u * p0[0] + 2 * u * t * ctrl[0] + t * t * p1[0],
      u * u * p0[1] + 2 * u * t * ctrl[1] + t * t * p1[1],
    ]);
  }
  return path(pts, s);
}

/** Sample points of a cubic bezier (for composing closed organic outlines). */
export function cubicPoints(
  p0: readonly [number, number],
  c1: readonly [number, number],
  c2: readonly [number, number],
  p1: readonly [number, number],
  segments = 16,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    pts.push([
      u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p1[0],
      u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p1[1],
    ]);
  }
  return pts;
}

/** Rectangle with rounded corners of radius r, as one closed path. */
export function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  s: Style = {},
): DrawOp {
  const rr = Math.min(r, w / 2, h / 2);
  const corner = (cx: number, cy: number, a0: number): [number, number][] =>
    Array.from({ length: 7 }, (_, i) => {
      const a = a0 + (i / 6) * (Math.PI / 2);
      return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    });
  return polygon(
    [
      ...corner(x + w - rr, y + rr, -Math.PI / 2),
      ...corner(x + w - rr, y + h - rr, 0),
      ...corner(x + rr, y + h - rr, Math.PI / 2),
      ...corner(x + rr, y + rr, Math.PI),
    ],
    s,
  );
}

/** Regular polygon with `n` sides (hexagon, octagon) starting at angle `phase`. */
export function ngon(
  cx: number,
  cy: number,
  r: number,
  n: number,
  s: Style = {},
  phase = -Math.PI / 2,
): DrawOp {
  return polygon(
    Array.from({ length: n }, (_, i) => {
      const a = phase + (i / n) * Math.PI * 2;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
    s,
  );
}

type PointMap = (x: number, y: number) => [number, number];

/** Apply a point transform to every op. `k` scales radii and rect sizes. */
export function mapOps(ops: readonly DrawOp[], f: PointMap, k = 1): DrawOp[] {
  const out: DrawOp[] = [];
  for (const op of ops) {
    switch (op.kind) {
      case "path":
        out.push({ ...op, points: op.points.map(([x, y]) => pt(...f(x, y))) });
        break;
      case "line":
        out.push({ ...op, from: pt(...f(...op.from)), to: pt(...f(...op.to)) });
        break;
      case "rect": {
        const [ax, ay] = f(op.x, op.y);
        const [bx, by] = f(op.x + op.w, op.y + op.h);
        const st: Style = { width: op.width, color: op.color };
        if (op.fill) st.fill = op.fill;
        out.push(
          rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), st),
        );
        break;
      }
      case "ellipse": {
        const [cx, cy] = f(op.cx, op.cy);
        const st: Style = { width: op.width, color: op.color };
        if (op.fill) st.fill = op.fill;
        out.push(ellipse(cx, cy, op.rx * Math.abs(k), op.ry * Math.abs(k), st));
        break;
      }
    }
  }
  return out;
}

export function translate(ops: readonly DrawOp[], dx: number, dy: number): DrawOp[] {
  return mapOps(ops, (x, y) => [x + dx, y + dy]);
}

/** Scale about (ox, oy). Stroke widths are unchanged. */
export function scale(ops: readonly DrawOp[], k: number, ox = 500, oy = 500): DrawOp[] {
  return mapOps(ops, (x, y) => [ox + (x - ox) * k, oy + (y - oy) * k], k);
}

/** Mirror horizontally about x = axis. */
export function mirrorX(ops: readonly DrawOp[], axis = 500): DrawOp[] {
  return mapOps(ops, (x, y) => [2 * axis - x, y]);
}

/** Rotate by `rad` about (ox, oy). Ellipses keep their axes (only the centre moves). */
export function rotate(ops: readonly DrawOp[], rad: number, ox = 500, oy = 500): DrawOp[] {
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  return mapOps(ops, (x, y) => {
    const dx = x - ox;
    const dy = y - oy;
    return [ox + dx * cs - dy * sn, oy + dx * sn + dy * cs];
  });
}

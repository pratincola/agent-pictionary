/**
 * Reusable building blocks shared by many drawings: a four-legged animal
 * body, a stick figure, a simple face, a wheel. Drawings compose these and
 * add the one or two features that make the word recognizable.
 */
import type { DrawOp } from "@pictionary/protocol";
import { FILL_INK, INK_HEX, PI, THICK, THIN } from "./palette.js";
import { arc, circle, dot, ellipse, line, path, polygon, type Style } from "./shapes.js";

export interface QuadrupedSpec {
  /** Body ellipse. */
  body?: { cx: number; cy: number; rx: number; ry: number };
  /** Head ellipse (left of the body by default: the animal faces left). */
  head?: { cx: number; cy: number; rx: number; ry: number };
  /** Leg x positions; legs run from the body bottom to `legBottom`. */
  legXs?: number[];
  legTop?: number;
  legBottom?: number;
  legStyle?: Style;
  /** Draw the neck line from head to body. */
  neck?: boolean;
  style?: Style;
  eye?: boolean;
}

/** Body + head + legs + eye. Faces left. */
export function quadruped(spec: QuadrupedSpec = {}): DrawOp[] {
  const body = spec.body ?? { cx: 560, cy: 600, rx: 250, ry: 150 };
  const head = spec.head ?? { cx: 270, cy: 430, rx: 110, ry: 100 };
  const legXs = spec.legXs ?? [420, 520, 620, 720];
  const legTop = spec.legTop ?? body.cy + body.ry - 20;
  const legBottom = spec.legBottom ?? 900;
  const s = spec.style ?? {};
  const ls = spec.legStyle ?? { ...THICK, ...s };
  const ops: DrawOp[] = [
    ellipse(body.cx, body.cy, body.rx, body.ry, s),
    ellipse(head.cx, head.cy, head.rx, head.ry, s),
  ];
  if (spec.neck !== false) {
    ops.push(
      line(
        head.cx + head.rx * 0.6,
        head.cy + head.ry * 0.6,
        body.cx - body.rx * 0.55,
        body.cy - body.ry * 0.6,
        s,
      ),
    );
  }
  for (const x of legXs) ops.push(line(x, legTop, x, legBottom, ls));
  if (spec.eye !== false) ops.push(dot(head.cx - head.rx * 0.35, head.cy - head.ry * 0.25, 12));
  return ops;
}

export interface FigureSpec {
  cx?: number;
  /** Top of the head. */
  top?: number;
  /** Total height head-to-feet. */
  h?: number;
  style?: Style;
  /** Arm pose: "down" (default), "up" or "out". */
  arms?: "down" | "up" | "out";
  face?: boolean;
}

/** Stick figure with a round head. Returns [head, body, armL, armR, legL, legR, ...face]. */
export function stickFigure(spec: FigureSpec = {}): DrawOp[] {
  const cx = spec.cx ?? 500;
  const top = spec.top ?? 150;
  const h = spec.h ?? 700;
  const s = spec.style ?? THICK;
  const r = h * 0.12;
  const neck = top + 2 * r;
  const hip = top + h * 0.62;
  const feet = top + h;
  const shoulder = neck + h * 0.06;
  const armLen = h * 0.3;
  const arm = (dir: 1 | -1): DrawOp => {
    if (spec.arms === "up")
      return line(cx, shoulder, cx + dir * armLen * 0.7, shoulder - armLen * 0.7, s);
    if (spec.arms === "out") return line(cx, shoulder, cx + dir * armLen, shoulder, s);
    return line(cx, shoulder, cx + dir * armLen * 0.6, shoulder + armLen * 0.8, s);
  };
  const ops: DrawOp[] = [
    circle(cx, top + r, r, s),
    line(cx, neck, cx, hip, s),
    arm(-1),
    arm(1),
    line(cx, hip, cx - h * 0.16, feet, s),
    line(cx, hip, cx + h * 0.16, feet, s),
  ];
  if (spec.face) {
    ops.push(
      dot(cx - r * 0.35, top + r * 0.85, r * 0.1),
      dot(cx + r * 0.35, top + r * 0.85, r * 0.1),
    );
    ops.push(arc(cx, top + r * 1.1, r * 0.45, 0.3, PI - 0.3, THIN, 8));
  }
  return ops;
}

/** Round face with two eyes and a smile. */
export function smileyFace(cx: number, cy: number, r: number, s: Style = THICK): DrawOp[] {
  return [
    circle(cx, cy, r, s),
    dot(cx - r * 0.38, cy - r * 0.25, r * 0.08),
    dot(cx + r * 0.38, cy - r * 0.25, r * 0.08),
    arc(cx, cy + r * 0.1, r * 0.55, 0.35, PI - 0.35, {}, 12),
  ];
}

/** Almond eye with iris and pupil, width w. */
export function eyeShape(cx: number, cy: number, w: number, s: Style = {}): DrawOp[] {
  const h = w * 0.55;
  return [
    arc(cx, cy + h * 0.5, w * 0.72, PI * 1.2, PI * 1.8, s, 16),
    arc(cx, cy - h * 0.5, w * 0.72, PI * 0.2, PI * 0.8, s, 16),
    circle(cx, cy, h * 0.42, s),
    dot(cx, cy, h * 0.2),
  ];
}

/** Thick-rimmed wheel with hub. */
export function wheel(cx: number, cy: number, r: number, s: Style = THICK): DrawOp[] {
  return [circle(cx, cy, r, s), circle(cx, cy, r * 0.3)];
}

/** Four-pointed sparkle (shine on gems, stars). */
export function sparkle(cx: number, cy: number, r: number, s: Style = THIN): DrawOp[] {
  return [line(cx - r, cy, cx + r, cy, s), line(cx, cy - r, cx, cy + r, s)];
}

/** Flat ground line. */
export function ground(y = 880, s: Style = THICK): DrawOp {
  return line(60, y, 940, y, s);
}

/** Simple triangle ear (polygon). */
export function triEar(
  baseL: readonly [number, number],
  tip: readonly [number, number],
  baseR: readonly [number, number],
  s: Style = {},
): DrawOp {
  return polygon([baseL, tip, baseR], s);
}

/** Small filled nose triangle pointing down. */
export function noseTri(cx: number, cy: number, w: number): DrawOp {
  return polygon(
    [
      [cx - w / 2, cy],
      [cx + w / 2, cy],
      [cx, cy + w * 0.7],
    ],
    FILL_INK,
  );
}

/** Three whiskers on each side of (cx, cy). */
export function whiskers(cx: number, cy: number, len: number): DrawOp[] {
  return [-1, 1].flatMap((d) => [
    line(cx + d * 30, cy - 20, cx + d * (30 + len), cy - 50, THIN),
    line(cx + d * 30, cy, cx + d * (30 + len), cy, THIN),
    line(cx + d * 30, cy + 20, cx + d * (30 + len), cy + 50, THIN),
  ]);
}

/** Flame: outer teardrop + inner teardrop. */
export function flame(cx: number, baseY: number, h: number, outer: Style, inner: Style): DrawOp[] {
  const tear = (hh: number, w: number, s: Style): DrawOp =>
    path(
      [
        [cx, baseY - hh],
        [cx + w * 0.5, baseY - hh * 0.55],
        [cx + w * 0.6, baseY - hh * 0.2],
        [cx + w * 0.3, baseY],
        [cx - w * 0.3, baseY],
        [cx - w * 0.6, baseY - hh * 0.2],
        [cx - w * 0.5, baseY - hh * 0.55],
        [cx, baseY - hh],
      ],
      s,
    );
  return [tear(h, h * 0.75, outer), tear(h * 0.5, h * 0.35, inner)];
}

export const INK = INK_HEX;

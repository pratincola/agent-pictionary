import { z } from "zod";

export const CANVAS_SIZE = 1000;
export const MAX_PATH_POINTS = 500;
export const MAX_OPS_PER_MESSAGE = 20;
export const MAX_OPS_PER_SECOND = 30;

/** Integer coordinate inside the 1000x1000 logical canvas (inclusive bounds). */
export const Coord = z.number().int().min(0).max(CANVAS_SIZE);
export type Coord = z.infer<typeof Coord>;

export const Point = z.tuple([Coord, Coord]);
export type Point = z.infer<typeof Point>;

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex color like #1a2b3c");
export type HexColor = z.infer<typeof HexColor>;

export const StrokeWidth = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(8),
  z.literal(12),
]);
export type StrokeWidth = z.infer<typeof StrokeWidth>;

const base = { width: StrokeWidth, color: HexColor };

export const PathOp = z.object({
  kind: z.literal("path"),
  points: z.array(Point).min(1).max(MAX_PATH_POINTS),
  ...base,
});
export const LineOp = z.object({
  kind: z.literal("line"),
  from: Point,
  to: Point,
  ...base,
});
export const RectOp = z
  .object({
    kind: z.literal("rect"),
    x: Coord,
    y: Coord,
    w: z.number().int().min(0).max(CANVAS_SIZE),
    h: z.number().int().min(0).max(CANVAS_SIZE),
    fill: HexColor.optional(),
    ...base,
  })
  .refine((r) => r.x + r.w <= CANVAS_SIZE && r.y + r.h <= CANVAS_SIZE, {
    message: "rect exceeds canvas bounds",
  });
export const EllipseOp = z
  .object({
    kind: z.literal("ellipse"),
    cx: Coord,
    cy: Coord,
    rx: z.number().int().min(0).max(CANVAS_SIZE),
    ry: z.number().int().min(0).max(CANVAS_SIZE),
    fill: HexColor.optional(),
    ...base,
  })
  .refine(
    (e) =>
      e.cx - e.rx >= 0 &&
      e.cx + e.rx <= CANVAS_SIZE &&
      e.cy - e.ry >= 0 &&
      e.cy + e.ry <= CANVAS_SIZE,
    { message: "ellipse exceeds canvas bounds" },
  );

/** No text op exists, by design (PLAN.md §5, §10). */
export const DrawOp = z.discriminatedUnion("kind", [PathOp, LineOp, RectOp, EllipseOp]);
export type DrawOp = z.infer<typeof DrawOp>;

/** One entry of a round's append-only op log. `erased` is set by draw.erase/draw.clear. */
export const OpLogEntry = z.object({
  opSeq: z.number().int().positive(),
  op: DrawOp,
  erased: z.boolean().optional(),
});
export type OpLogEntry = z.infer<typeof OpLogEntry>;

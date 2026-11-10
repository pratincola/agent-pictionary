import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WORD_POOL } from "@pictionary/engine";
import {
  CANVAS_SIZE,
  DrawOp,
  DrawOpsPayload,
  normalizeGuess,
  type WordOption,
} from "@pictionary/protocol";
import { renderPng } from "@pictionary/render";
import { describe, expect, it } from "vitest";
import { DRAWINGS } from "../src/library/drawings.js";
import { wordsByTier } from "../src/library/generate.js";
import { libraryDir, placeholderDrawing, StrokeLibrary } from "../src/library/loader.js";
import { INK_HEX, WHITE_HEX } from "../src/library/palette.js";
import { animateOps, LibraryDrawer } from "../src/strategies/drawer.js";

const MIN_OPS = 6;
const MAX_OPS = 80;
/** Drawings allowed more than two accent colors (the subject is the colors). */
const COLOR_EXEMPT = new Set(["rainbow"]);

function bounds(op: DrawOp): [number, number, number, number] {
  switch (op.kind) {
    case "path": {
      const xs = op.points.map((p) => p[0]);
      const ys = op.points.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    case "line":
      return [
        Math.min(op.from[0], op.to[0]),
        Math.min(op.from[1], op.to[1]),
        Math.max(op.from[0], op.to[0]),
        Math.max(op.from[1], op.to[1]),
      ];
    case "rect":
      return [op.x, op.y, op.x + op.w, op.y + op.h];
    case "ellipse":
      return [op.cx - op.rx, op.cy - op.ry, op.cx + op.rx, op.cy + op.ry];
  }
}

describe("stroke library", () => {
  it("every programmatic drawing produces valid ops for a real pool word", () => {
    const pool = new Set(
      WORD_POOL.flatMap((w) => [w.word, ...(w.aliases ?? [])].map(normalizeGuess)),
    );
    for (const [word, make] of Object.entries(DRAWINGS)) {
      const ops = make();
      expect(ops.length, word).toBeGreaterThan(0);
      for (const op of ops)
        expect(() => DrawOp.parse(op), `${word}: ${JSON.stringify(op)}`).not.toThrow();
      expect(pool.has(normalizeGuess(word)), `${word} is not in the pool`).toBe(true);
    }
    expect(Object.keys(DRAWINGS).length).toBeGreaterThanOrEqual(40);
  });

  it("covers every easy word in the pool", () => {
    const lib = new StrokeLibrary();
    const missing = WORD_POOL.filter((w) => w.difficulty === "easy" && !lib.has(w.word)).map(
      (w) => w.word,
    );
    expect(missing).toEqual([]);
    const tiers = wordsByTier();
    expect(tiers.easy.length).toBeGreaterThanOrEqual(146);
    expect(tiers.medium.length).toBeGreaterThanOrEqual(60);
    expect(tiers.other).toEqual([]);
  });

  it("every drawing has 6-80 ops, stays in bounds and uses at most two accent colors", () => {
    for (const [word, make] of Object.entries(DRAWINGS)) {
      const ops = make();
      expect(ops.length, `${word}: ${ops.length} ops`).toBeGreaterThanOrEqual(MIN_OPS);
      expect(ops.length, `${word}: ${ops.length} ops`).toBeLessThanOrEqual(MAX_OPS);
      const accents = new Set<string>();
      for (const op of ops) {
        const [x0, y0, x1, y1] = bounds(op);
        expect(x0, `${word}: out of bounds`).toBeGreaterThanOrEqual(0);
        expect(y0, `${word}: out of bounds`).toBeGreaterThanOrEqual(0);
        expect(x1, `${word}: out of bounds`).toBeLessThanOrEqual(CANVAS_SIZE);
        expect(y1, `${word}: out of bounds`).toBeLessThanOrEqual(CANVAS_SIZE);
        for (const c of [op.color, "fill" in op ? op.fill : undefined]) {
          if (c && c !== INK_HEX && c !== WHITE_HEX) accents.add(c);
        }
      }
      if (!COLOR_EXEMPT.has(word)) {
        expect(accents.size, `${word}: accents ${[...accents].join(",")}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("LibraryDrawer.choose prefers the option that is in the library", () => {
    const options: WordOption[] = [
      { index: 0, word: "photosynthesis", difficulty: "hard" },
      { index: 1, word: "glacier", difficulty: "medium" },
      { index: 2, word: "cat", difficulty: "easy" },
    ];
    const chosen: string[] = [];
    const drawer = new LibraryDrawer({ onWord: (w) => chosen.push(w) });
    expect(drawer.library.has("glacier")).toBe(false);
    expect(drawer.choose(options)).toBe(2);
    expect(chosen).toEqual(["cat"]);
    // Nothing in the library: falls back to the first option.
    expect(drawer.choose([options[0] as WordOption, options[1] as WordOption])).toBe(0);
  });

  it("renders a sample of entries to PNG", () => {
    const words = Object.keys(DRAWINGS);
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    for (let i = 0; i < 5; i++) {
      const word = words[next() % words.length] as string;
      const png = renderPng(DRAWINGS[word]?.() ?? [], { size: 128 });
      expect(png.length, word).toBeGreaterThan(100);
      // PNG signature
      expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
    }
  });

  it("the checked-in JSON files match the generator and parse as ops", () => {
    const dir = libraryDir();
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(Object.keys(DRAWINGS).length);
    for (const f of files) {
      const json = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
        word: string;
        ops: unknown[];
      };
      const expected = DRAWINGS[json.word];
      expect(expected, `${f}: unknown word ${json.word}`).toBeDefined();
      expect(json.ops).toEqual(expected?.());
    }
  });

  it("loads by normalized word and returns copies", () => {
    const lib = new StrokeLibrary();
    expect(lib.size).toBeGreaterThanOrEqual(40);
    expect(lib.has("Ice Cream")).toBe(true);
    expect(lib.has("the cat")).toBe(true);
    expect(lib.has("photosynthesis")).toBe(false);
    const a = lib.get("cat") as DrawOp[];
    const b = lib.get("cat") as DrawOp[];
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(b[0]);
    expect(lib.get("nope")).toBeUndefined();
  });

  it("placeholder is valid and uses no text", () => {
    for (const op of placeholderDrawing()) DrawOp.parse(op);
  });

  it("animateOps splits long paths into overlapping segments and keeps everything else", () => {
    const long: DrawOp = {
      kind: "path",
      points: Array.from({ length: 20 }, (_, i) => [i * 10, i * 10]),
      width: 4,
      color: "#000000",
    };
    const short: DrawOp = { kind: "line", from: [0, 0], to: [1, 1], width: 2, color: "#000000" };
    const out = animateOps([long, short], 6);
    expect(out.at(-1)).toEqual(short);
    const segs = out.slice(0, -1);
    expect(segs.length).toBe(4); // 19 edges / 6 per segment -> 4 segments
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1];
      const cur = segs[i];
      if (prev?.kind !== "path" || cur?.kind !== "path") throw new Error("expected paths");
      expect(cur.points[0]).toEqual(prev.points.at(-1)); // shared endpoint
    }
    for (const s of segs) DrawOpsPayload.parse({ ops: [s] });
  });
});

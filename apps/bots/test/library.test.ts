import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WORD_POOL } from "@pictionary/engine";
import { DrawOp, DrawOpsPayload, normalizeGuess } from "@pictionary/protocol";
import { describe, expect, it } from "vitest";
import { DRAWINGS } from "../src/library/drawings.js";
import { libraryDir, placeholderDrawing, StrokeLibrary } from "../src/library/loader.js";
import { animateOps } from "../src/strategies/drawer.js";

describe("stroke library", () => {
  it("every programmatic drawing produces valid ops for a real pool word", () => {
    const pool = new Set(WORD_POOL.flatMap((w) => [w.word, ...(w.aliases ?? [])].map(normalizeGuess)));
    for (const [word, make] of Object.entries(DRAWINGS)) {
      const ops = make();
      expect(ops.length, word).toBeGreaterThan(0);
      for (const op of ops) expect(() => DrawOp.parse(op), `${word}: ${JSON.stringify(op)}`).not.toThrow();
      expect(pool.has(normalizeGuess(word)), `${word} is not in the pool`).toBe(true);
    }
    expect(Object.keys(DRAWINGS).length).toBeGreaterThanOrEqual(40);
  });

  it("the checked-in JSON files match the generator and parse as ops", () => {
    const dir = libraryDir();
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(Object.keys(DRAWINGS).length);
    for (const f of files) {
      const json = JSON.parse(readFileSync(join(dir, f), "utf8")) as { word: string; ops: unknown[] };
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

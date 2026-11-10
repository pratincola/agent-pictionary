/**
 * Loads the stroke library (apps/bots/library/*.json). Each file is
 * `{ word, ops: DrawOp[] }`. Words are matched after guess normalization so
 * "Ice Cream" and "ice cream" hit the same file.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DrawOp, DrawOp as DrawOpSchema, normalizeGuess } from "@pictionary/protocol";
import { z } from "zod";

const Entry = z.object({ word: z.string().min(1), ops: z.array(DrawOpSchema).min(1) });
export type LibraryEntry = z.infer<typeof Entry>;

/** apps/bots/library, resolved from src/library or dist/library. */
export function libraryDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "library");
}

export function slug(word: string): string {
  return normalizeGuess(word).replace(/\s+/g, "-");
}

export class StrokeLibrary {
  private readonly entries = new Map<string, LibraryEntry>();

  constructor(dir = libraryDir()) {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const parsed = Entry.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (parsed.success) this.entries.set(normalizeGuess(parsed.data.word), parsed.data);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  words(): string[] {
    return [...this.entries.keys()];
  }

  has(word: string): boolean {
    return this.entries.has(normalizeGuess(word));
  }

  /** Ops for `word`, or undefined when the library has no drawing for it. */
  get(word: string): DrawOp[] | undefined {
    return this.entries.get(normalizeGuess(word))?.ops.map((op) => ({ ...op }));
  }
}

/**
 * Placeholder for words outside the library: a framed question mark made of
 * strokes (no text op exists, and this is not a letter of the word).
 */
export function placeholderDrawing(): DrawOp[] {
  return [
    { kind: "rect", x: 150, y: 150, w: 700, h: 700, width: 4, color: "#1f2430" },
    {
      kind: "path",
      points: Array.from({ length: 17 }, (_, i) => {
        const a = Math.PI * 1.1 + (i / 16) * Math.PI * 1.3;
        return [Math.round(500 + 150 * Math.cos(a)), Math.round(420 + 150 * Math.sin(a))];
      }),
      width: 12,
      color: "#1f2430",
    },
    { kind: "line", from: [500, 570], to: [500, 680], width: 12, color: "#1f2430" },
    { kind: "ellipse", cx: 500, cy: 760, rx: 16, ry: 16, width: 4, color: "#1f2430", fill: "#1f2430" },
  ];
}

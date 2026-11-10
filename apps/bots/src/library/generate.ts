/**
 * Writes apps/bots/library/<word>.json from the programmatic drawings and,
 * with --sheet <dir>, a labelled contact sheet per tier (preview only: the
 * labels are canvas text in the PNG, never ops). Run after changing drawings:
 *
 *   pnpm -F @pictionary/bots build && pnpm -F @pictionary/bots gen:library
 *
 * Options: --png <dir> (one PNG per word), --sheet <dir> (contact sheets),
 * --pages (also split each sheet into 40-tile pages for review).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { WORD_POOL } from "@pictionary/engine";
import { DrawOp, normalizeGuess } from "@pictionary/protocol";
import { renderPng } from "@pictionary/render";
import { DRAWINGS } from "./drawings.js";
import { libraryDir, slug } from "./loader.js";

export function generateLibrary(outDir = libraryDir(), pngDir?: string): string[] {
  mkdirSync(outDir, { recursive: true });
  if (pngDir) mkdirSync(pngDir, { recursive: true });
  const written: string[] = [];
  for (const [word, make] of Object.entries(DRAWINGS)) {
    const ops = make().map((op) => DrawOp.parse(op));
    const file = join(outDir, `${slug(word)}.json`);
    writeFileSync(file, `${JSON.stringify({ word, ops }, null, 2)}\n`);
    written.push(file);
    if (pngDir) writeFileSync(join(pngDir, `${slug(word)}.png`), renderPng(ops, { size: 256 }));
  }
  return written;
}

export type Tier = "easy" | "medium" | "hard" | "other";

/** Library words grouped by pool difficulty ("other" = alias-only or not in the pool). */
export function wordsByTier(): Record<Tier, string[]> {
  const tierOf = new Map<string, Tier>();
  for (const w of WORD_POOL) {
    tierOf.set(normalizeGuess(w.word), w.difficulty);
    for (const a of w.aliases ?? []) tierOf.set(normalizeGuess(a), w.difficulty);
  }
  const out: Record<Tier, string[]> = { easy: [], medium: [], hard: [], other: [] };
  for (const word of Object.keys(DRAWINGS).sort()) {
    out[tierOf.get(normalizeGuess(word)) ?? "other"].push(word);
  }
  return out;
}

const TILE = 256;
const LABEL = 36;
const COLS = 8;

/** Grid of rendered drawings with the word written under each tile. */
export async function contactSheet(words: readonly string[]): Promise<Buffer> {
  const rows = Math.max(1, Math.ceil(words.length / COLS));
  const canvas = createCanvas(COLS * TILE, rows * (TILE + LABEL));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "22px sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    const make = DRAWINGS[word];
    if (!make) continue;
    const x = (i % COLS) * TILE;
    const y = Math.floor(i / COLS) * (TILE + LABEL);
    const img = await loadImage(renderPng(make(), { size: TILE }));
    ctx.drawImage(img, x, y);
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    ctx.fillStyle = "#1f2430";
    ctx.fillText(word, x + TILE / 2, y + TILE + 26);
  }
  return canvas.toBuffer("image/png");
}

export async function writeContactSheets(dir: string, pages = false): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const [tier, words] of Object.entries(wordsByTier()) as [Tier, string[]][]) {
    if (words.length === 0) continue;
    const file = join(dir, `contact-sheet-${tier}.png`);
    writeFileSync(file, await contactSheet(words));
    files.push(file);
    if (pages) {
      const per = COLS * 5;
      for (let p = 0; p * per < words.length; p++) {
        const pf = join(dir, `contact-sheet-${tier}-p${p + 1}.png`);
        writeFileSync(pf, await contactSheet(words.slice(p * per, (p + 1) * per)));
        files.push(pf);
      }
    }
  }
  return files;
}

if (process.argv[1]?.endsWith("generate.js") || process.argv[1]?.endsWith("generate.ts")) {
  const argAfter = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const pngDir = argAfter("--png");
  const sheetDir = argAfter("--sheet");
  const files = generateLibrary(undefined, pngDir);
  console.log(
    `wrote ${files.length} drawings to ${libraryDir()}${pngDir ? ` and PNGs to ${pngDir}` : ""}`,
  );
  if (sheetDir) {
    const sheets = await writeContactSheets(sheetDir, process.argv.includes("--pages"));
    const tiers = wordsByTier();
    console.log(
      `contact sheets: ${sheets.join(", ")} (easy ${tiers.easy.length}, medium ${tiers.medium.length}, hard ${tiers.hard.length}, other ${tiers.other.length})`,
    );
  }
}

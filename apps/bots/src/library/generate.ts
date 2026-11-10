/**
 * Writes apps/bots/library/<word>.json from the programmatic drawings and,
 * with --png <dir>, a preview PNG per word. Run after changing drawings.ts:
 *
 *   pnpm -F @pictionary/bots build && pnpm -F @pictionary/bots gen:library
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DrawOp } from "@pictionary/protocol";
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

if (process.argv[1]?.endsWith("generate.js") || process.argv[1]?.endsWith("generate.ts")) {
  const pngIdx = process.argv.indexOf("--png");
  const pngDir = pngIdx > 0 ? process.argv[pngIdx + 1] : undefined;
  const files = generateLibrary(undefined, pngDir);
  console.log(
    `wrote ${files.length} drawings to ${libraryDir()}${pngDir ? ` and PNGs to ${pngDir}` : ""}`,
  );
}

/**
 * Drawer strategy: pick a word option, then stream a library drawing over
 * ~20–40 s so spectators see it appear. Long paths are split into short
 * segments that share endpoints, which makes a stroke "grow" on screen.
 */
import type { DrawOp, WordOption } from "@pictionary/protocol";
import type { AgentClient } from "@pictionary/sdk";
import { placeholderDrawing, StrokeLibrary } from "../library/loader.js";
import { sleep } from "../util.js";

export interface DrawerStrategy {
  /** Index of the option to choose (0..2). */
  choose(options: WordOption[]): 0 | 1 | 2;
  /** Draw `word`. Must stop promptly when `signal` aborts (round ended). */
  draw(client: AgentClient, word: string, signal: AbortSignal): Promise<void>;
}

export interface LibraryDrawerOptions {
  /** Which option to pick. Default: the first whose word is in the library, else 0. */
  index?: 0 | 1 | 2;
  /** Target drawing duration in ms. Default 30_000. */
  durationMs?: number;
  /** Points per streamed path segment. Default 6. */
  segmentPoints?: number;
  library?: StrokeLibrary;
  /** Called with the chosen word (used by in-process oracle guessers and the race). */
  onWord?: (word: string) => void;
}

/** Split long paths so the drawing animates; other ops pass through. */
export function animateOps(ops: readonly DrawOp[], segmentPoints = 6): DrawOp[] {
  const out: DrawOp[] = [];
  for (const op of ops) {
    if (op.kind !== "path" || op.points.length <= segmentPoints + 1) {
      out.push(op);
      continue;
    }
    for (let i = 0; i < op.points.length - 1; i += segmentPoints) {
      const points = op.points.slice(i, i + segmentPoints + 1);
      if (points.length >= 2) out.push({ ...op, points });
    }
  }
  return out;
}

export class LibraryDrawer implements DrawerStrategy {
  readonly library: StrokeLibrary;
  constructor(private readonly opts: LibraryDrawerOptions = {}) {
    this.library = opts.library ?? new StrokeLibrary();
  }

  choose(options: WordOption[]): 0 | 1 | 2 {
    const pick =
      this.opts.index ??
      ((options.find((o) => this.library.has(o.word))?.index ?? 0) as 0 | 1 | 2);
    const word = options.find((o) => o.index === pick)?.word;
    if (word) this.opts.onWord?.(word);
    return pick;
  }

  opsFor(word: string): DrawOp[] {
    return this.library.get(word) ?? placeholderDrawing();
  }

  async draw(client: AgentClient, word: string, signal: AbortSignal): Promise<void> {
    const ops = animateOps(this.opsFor(word), this.opts.segmentPoints ?? 6);
    const duration = this.opts.durationMs ?? 30_000;
    const delay = Math.min(1500, Math.max(50, Math.floor(duration / Math.max(1, ops.length))));
    for (const op of ops) {
      if (signal.aborted || !client.isDrawer()) return;
      try {
        await client.draw([op]);
      } catch (err) {
        if (signal.aborted) return;
        throw err;
      }
      await sleep(delay, signal);
    }
  }
}

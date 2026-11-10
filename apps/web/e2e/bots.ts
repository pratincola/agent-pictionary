/**
 * Scripted agents for the E2E suite, built on the server test helpers
 * (`apps/server/test/helpers.ts`): the same WsClient, setupRoom and
 * startAndChoose the integration tests use.
 */
import type { DrawOp } from "@pictionary/protocol";
import {
  createRoom,
  createSession,
  type Player,
  registerAgent,
  setupRoom,
  sleep,
  startAndChoose,
  WsClient,
} from "../../server/test/helpers.js";

export { createRoom, createSession, registerAgent, setupRoom, sleep, startAndChoose, WsClient };
export type { Player };

const INK = "#1b1b1f";

/** A smiley with spiky hair: 1 face + 2 eyes + 1 mouth + 36 hair lines = 40 ops. */
export function smileyOps(): DrawOp[] {
  const ops: DrawOp[] = [];
  ops.push({ kind: "ellipse", cx: 500, cy: 520, rx: 300, ry: 300, width: 8, color: INK });
  ops.push({
    kind: "ellipse",
    cx: 400,
    cy: 440,
    rx: 30,
    ry: 40,
    width: 4,
    color: INK,
    fill: "#2b6cb0",
  });
  ops.push({
    kind: "ellipse",
    cx: 600,
    cy: 440,
    rx: 30,
    ry: 40,
    width: 4,
    color: INK,
    fill: "#2b6cb0",
  });
  const mouth: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = Math.PI * (0.15 + (0.7 * i) / 24);
    mouth.push([Math.round(500 + 180 * Math.cos(t)), Math.round(560 + 120 * Math.sin(t))]);
  }
  ops.push({ kind: "path", points: mouth, width: 8, color: "#c53030" });
  for (let i = 0; i < 36; i++) {
    const t = Math.PI * (1.1 + (0.8 * i) / 35);
    const x0 = Math.round(500 + 300 * Math.cos(t));
    const y0 = Math.round(520 + 300 * Math.sin(t));
    const x1 = Math.round(500 + 400 * Math.cos(t));
    const y1 = Math.max(0, Math.round(520 + 400 * Math.sin(t)));
    ops.push({ kind: "line", from: [x0, y0], to: [x1, y1], width: 4, color: INK });
  }
  return ops;
}

/** `n` extra radial lines around the face (for "ops missed while offline" checks). */
export function extraLines(n: number): DrawOp[] {
  const ops: DrawOp[] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.PI * (0.1 + (0.8 * i) / Math.max(1, n - 1));
    ops.push({
      kind: "line",
      from: [Math.round(500 + 310 * Math.cos(t)), Math.round(520 + 310 * Math.sin(t))],
      to: [Math.round(500 + 380 * Math.cos(t)), Math.min(1000, Math.round(520 + 380 * Math.sin(t)))],
      width: 2,
      color: "#2f855a",
    });
  }
  return ops;
}

/**
 * Send ops in batches of 20 under the 30 ops/s token bucket (burst 30, refill
 * 30/s): a 700 ms pause before each batch refills at least 20 tokens even
 * when the previous call drained the bucket. Returns the last assigned opSeq.
 */
export async function drawAll(drawer: Player, ops: DrawOp[]): Promise<number> {
  let last = 0;
  for (let i = 0; i < ops.length; i += 20) {
    await sleep(700);
    const reply = await drawer.ws.request("draw.ops", { ops: ops.slice(i, i + 20) });
    if (reply.type !== "ack") throw new Error(`draw.ops rejected: ${JSON.stringify(reply)}`);
    last = reply.payload.opSeqTo ?? last;
  }
  return last;
}

/** Each guesser burns all its guesses on words that are not close to anything. */
export async function missAll(guessers: Player[], perAgent = 3): Promise<void> {
  const wrong = ["quasarbanana", "velvetspanner", "glacierpretzel", "cobaltwaffle", "orbitpickle"];
  for (const g of guessers) {
    for (let i = 0; i < perAgent; i++) {
      const reply = await g.ws.request("guess.submit", { text: `${wrong[i % wrong.length]}${i}` });
      if (reply.type !== "guess.result" || reply.payload.result !== "incorrect") {
        throw new Error(`unexpected guess reply: ${JSON.stringify(reply)}`);
      }
    }
  }
}

/** The word the drawer picked (option 0 in startAndChoose). */
export function chosenWord(drawer: Player): string {
  const opts = drawer.ws.last("round.wordOptions");
  if (!opts) throw new Error("drawer never received word options");
  const w = opts.payload.options.find((o) => o.index === 0);
  if (!w) throw new Error("no option 0");
  return w.word;
}

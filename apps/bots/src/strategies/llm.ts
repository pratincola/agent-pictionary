/**
 * LLM (vision) guesser. Every `intervalMs` it renders the op log to a PNG,
 * sends it to an OpenAI-compatible chat endpoint (OpenRouter by default) and
 * submits the model's one-word answer. Hard cap on calls per round.
 *
 * Cost note: one call = one ~512px image + ~150 tokens. With the default
 * cap (6 calls/round) and google/gemini-2.5-flash that is well under a cent
 * per round; a 4-round demo stays under $0.05. See apps/bots/README.md.
 */
import { normalizeGuess, wordPattern } from "@pictionary/protocol";
import { renderDataUrl } from "@pictionary/render";
import { visibleOpLog } from "@pictionary/sdk";
import { sleep } from "../util.js";
import type { GuessContext, GuesserStrategy } from "./guesser.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface LlmGuesserOptions {
  apiKey: string;
  /** OpenRouter model id. Default google/gemini-2.5-flash. */
  model?: string;
  /** Chat completions base. Default https://openrouter.ai/api/v1 */
  baseUrl?: string;
  /** Seconds between looks at the canvas. Default 8. */
  intervalSec?: number;
  /** Max model calls per round. Default 6. */
  maxCallsPerRound?: number;
  /** Rendered image size in px. Default 512. */
  imageSize?: number;
  /** Skip a call when the canvas has not changed since the last one. Default true. */
  skipUnchanged?: boolean;
  fetch?: FetchLike;
  /** Request timeout in ms. Default 20_000. */
  timeoutMs?: number;
}

export const DEFAULT_LLM_MODEL = "google/gemini-2.5-flash";
export const DEFAULT_LLM_BASE = "https://openrouter.ai/api/v1";

export function buildPrompt(pattern: string, tried: Iterable<string>, lastResult?: string): string {
  const words = pattern.split(" ");
  const shape =
    words.length === 1
      ? `one word of ${words[0]?.length ?? 0} letters`
      : `${words.length} words with ${words.map((w) => w.length).join(", ")} letters (pattern "${pattern}")`;
  const triedList = [...tried];
  const lines = [
    "You are playing Pictionary. The image is a drawing in progress on a whiteboard.",
    `The secret answer is ${shape}.`,
    "Reply with ONLY your single best guess, lowercase, no punctuation, no explanation.",
  ];
  if (triedList.length > 0) lines.push(`Already tried and wrong: ${triedList.join(", ")}.`);
  if (lastResult === "close") lines.push("Your last guess was very close (one letter off).");
  return lines.join("\n");
}

/**
 * Turn a model reply into a guess. Takes the first line, strips quotes and
 * trailing punctuation, lowercases. Returns undefined for empty replies.
 * `fitsPattern` tells whether it matches the expected word shape.
 */
export function parseGuess(
  reply: string,
  pattern: string,
): { guess: string; fitsPattern: boolean } | undefined {
  const first = reply
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return undefined;
  let g = first.replace(/^(answer|guess)\s*[:\-]\s*/i, "");
  g = g.replace(/^["'`*_\s]+|["'`*_\s.!?]+$/g, "");
  const norm = normalizeGuess(g);
  if (!norm) return undefined;
  return { guess: norm, fitsPattern: wordPattern(norm) === pattern };
}

export interface ChatResult {
  text: string;
}

export async function chatWithImage(
  opts: Required<Pick<LlmGuesserOptions, "apiKey" | "model" | "baseUrl" | "fetch" | "timeoutMs">>,
  prompt: string,
  imageDataUrl: string,
): Promise<ChatResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await opts.fetch(`${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json",
        "http-referer": "https://github.com/pratincola/agent-pictionary",
        "x-title": "Agent Pictionary bot",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 20,
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`llm http ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | { text?: string }[] } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : (content ?? []).map((c) => c.text ?? "").join("\n");
    return { text };
  } finally {
    clearTimeout(t);
  }
}

export class LlmGuesser implements GuesserStrategy {
  readonly name = "llm";
  /** Total model calls made (all rounds). */
  calls = 0;
  constructor(private readonly opts: LlmGuesserOptions) {}

  async run(ctx: GuessContext, signal: AbortSignal): Promise<void> {
    const intervalMs = (this.opts.intervalSec ?? 8) * 1000;
    const cap = this.opts.maxCallsPerRound ?? 6;
    const chat = {
      apiKey: this.opts.apiKey,
      model: this.opts.model ?? DEFAULT_LLM_MODEL,
      baseUrl: this.opts.baseUrl ?? DEFAULT_LLM_BASE,
      fetch: this.opts.fetch ?? ((u: string, i: RequestInit) => fetch(u, i)),
      timeoutMs: this.opts.timeoutMs ?? 20_000,
    };
    let callsThisRound = 0;
    let lastOpSeq = -1;
    let lastResult: string | undefined;
    while (!signal.aborted && ctx.client.guessesRemaining() > 0 && callsThisRound < cap) {
      await sleep(intervalMs, signal);
      if (signal.aborted) return;
      const ops = visibleOpLog(ctx.client.state);
      const seq = ctx.client.lastOpSeq();
      if (ops.length === 0 || ((this.opts.skipUnchanged ?? true) && seq === lastOpSeq)) continue;
      lastOpSeq = seq;
      callsThisRound += 1;
      this.calls += 1;
      const image = renderDataUrl(ops, { size: this.opts.imageSize ?? 512 });
      let text: string;
      try {
        ({ text } = await chatWithImage(chat, buildPrompt(ctx.pattern, ctx.tried, lastResult), image));
      } catch (err) {
        ctx.log(`llm call failed: ${String(err)}`);
        continue;
      }
      if (signal.aborted) return;
      const parsed = parseGuess(text, ctx.pattern);
      if (!parsed) {
        ctx.log(`llm gave no usable guess: ${JSON.stringify(text.slice(0, 80))}`);
        continue;
      }
      if (ctx.tried.has(parsed.guess)) continue;
      ctx.log(`llm guesses "${parsed.guess}"${parsed.fitsPattern ? "" : " (pattern mismatch)"}`);
      const r = await ctx.guess(parsed.guess);
      if (!r) return;
      lastResult = r.result;
      if (r.result === "correct" || r.result === "late" || r.result === "round_over") return;
    }
  }
}

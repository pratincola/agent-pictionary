#!/usr/bin/env node
/**
 * ap-bots CLI. See apps/bots/README.md.
 *
 *   ap-bots demo   [--base URL] [--web-base URL] [--oracle-delay 25] [--llm]
 *   ap-bots race   [--base URL] [--n 50]
 *   ap-bots drawer --code CODE [--base URL] [--name N] [--index 0] [--duration 30]
 *   ap-bots guesser --code CODE --strategy random-pool|pattern|oracle [--delay 25] [--jitter 2]
 *   ap-bots llm-guesser --code CODE [--interval 8] [--max-calls 6] [--model google/gemini-2.5-flash]
 */
import { parseArgs } from "node:util";
import { registerAgent } from "@pictionary/sdk";
import { Bot } from "./bot.js";
import { runDemo } from "./demo.js";
import { runRace } from "./race.js";
import { LibraryDrawer } from "./strategies/drawer.js";
import {
  type GuesserStrategy,
  OracleGuesser,
  oracleWordFromEnv,
  PatternGuesser,
  RandomPoolGuesser,
} from "./strategies/guesser.js";
import { DEFAULT_LLM_MODEL, LlmGuesser } from "./strategies/llm.js";
import { prefixedLogger } from "./util.js";

const env = process.env;

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    base: { type: "string", default: env.AP_BASE_URL ?? "http://localhost:8080" },
    "web-base": { type: "string", default: env.WEB_BASE ?? "http://localhost:5173" },
    code: { type: "string" },
    name: { type: "string" },
    "api-key": { type: "string", default: env.AP_API_KEY },
    index: { type: "string" },
    duration: { type: "string", default: "30" },
    strategy: { type: "string", default: "pattern" },
    delay: { type: "string" },
    jitter: { type: "string" },
    "oracle-delay": { type: "string", default: "25" },
    interval: { type: "string", default: env.LLM_INTERVAL_SEC ?? "8" },
    "max-calls": { type: "string", default: env.LLM_MAX_CALLS ?? "6" },
    model: { type: "string", default: env.LLM_MODEL ?? DEFAULT_LLM_MODEL },
    n: { type: "string", default: "50" },
    llm: { type: "boolean", default: false },
    rounds: { type: "string", default: "1" },
    "draw-seconds": { type: "string", default: "90" },
    help: { type: "boolean", default: false },
  },
});

const command = positionals[0];
const num = (v: string | undefined, d: number) => (v === undefined ? d : Number(v));

function usage(): never {
  console.log(`ap-bots <command> [options]

commands
  demo          1 drawer + 3 guessers play a match; prints room code + spectator URL
  race          N guessers fire the correct word in one tick; prints winner + seq audit
  drawer        join a room and draw from the stroke library when it is your turn
  guesser       join a room and guess (--strategy random-pool|pattern|oracle)
  llm-guesser   join a room and guess with a vision LLM via OpenRouter

common options
  --base URL          server root (AP_BASE_URL, default http://localhost:8080)
  --code CODE         room code (drawer/guesser/llm-guesser)
  --name NAME         agent name (a fresh agent is registered unless --api-key/AP_API_KEY is set)

demo:  --web-base URL (WEB_BASE) --oracle-delay 25 --rounds 1 --draw-seconds 90 --llm
race:  --n 50
drawer: --index 0..2 --duration 30
guesser: --strategy pattern --delay 25 --jitter 2   (oracle reads AP_ORACLE_WORD)
llm-guesser: --interval 8 --max-calls 6 --model google/gemini-2.5-flash  (OPENROUTER_API_KEY)`);
  process.exit(command ? 1 : 0);
}

function llmGuesser(): LlmGuesser {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is required for the LLM guesser");
    process.exit(2);
  }
  const o: ConstructorParameters<typeof LlmGuesser>[0] = {
    apiKey,
    model: values.model as string,
    intervalSec: num(values.interval, 8),
    maxCallsPerRound: num(values["max-calls"], 6),
  };
  if (env.OPENROUTER_BASE_URL) o.baseUrl = env.OPENROUTER_BASE_URL;
  return new LlmGuesser(o);
}

async function joinAsBot(name: string, guesser: GuesserStrategy): Promise<void> {
  const code = values.code;
  if (!code) {
    console.error("--code is required");
    process.exit(1);
  }
  const base = values.base as string;
  let apiKey = values["api-key"];
  if (!apiKey) {
    const reg = await registerAgent(base, { name, humanHandle: `${name}-human` });
    apiKey = reg.apiKey;
    console.log(`registered ${name}: agentId=${reg.agentId} pairCode=${reg.humanPairCode}`);
    console.log(`(set AP_API_KEY=${reg.apiKey} to reuse this identity)`);
  }
  const idx = values.index === undefined ? undefined : (Number(values.index) as 0 | 1 | 2);
  const bot = new Bot({
    baseUrl: base,
    apiKey,
    name,
    drawer: new LibraryDrawer({
      ...(idx === undefined ? {} : { index: idx }),
      durationMs: num(values.duration, 30) * 1000,
    }),
    guesser,
    log: prefixedLogger(name),
  });
  await bot.join(code);
  await bot.ready();
  await bot.waitForMatchEnd();
  await bot.close();
}

async function main(): Promise<void> {
  if (values.help || !command) usage();
  const base = values.base as string;
  switch (command) {
    case "demo": {
      const extra = values.llm ? [{ name: "Gemini", strategy: llmGuesser() }] : [];
      await runDemo({
        baseUrl: base,
        spectatorUrl: env.SPECTATOR_URL ?? `${values["web-base"]}/r/{code}`,
        oracleDelaySec: num(values["oracle-delay"], 25),
        roundsPerPlayer: num(values.rounds, 1),
        drawSeconds: num(values["draw-seconds"], 90),
        extraGuessers: extra,
      });
      return;
    }
    case "race":
      await runRace({ baseUrl: base, n: num(values.n, 50) });
      return;
    case "drawer":
      await joinAsBot(values.name ?? "Drawer", new PatternGuesser());
      return;
    case "guesser": {
      const timing = {
        ...(values.delay === undefined ? {} : { delayMs: Number(values.delay) * 1000 }),
        ...(values.jitter === undefined ? {} : { jitterMs: Number(values.jitter) * 1000 }),
      };
      const s = values.strategy;
      const strategy: GuesserStrategy =
        s === "random-pool"
          ? new RandomPoolGuesser(timing)
          : s === "oracle"
            ? new OracleGuesser({ ...timing, word: oracleWordFromEnv() })
            : new PatternGuesser(timing);
      await joinAsBot(values.name ?? `Guesser-${s}`, strategy);
      return;
    }
    case "llm-guesser":
      await joinAsBot(values.name ?? "Gemini", llmGuesser());
      return;
    default:
      usage();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

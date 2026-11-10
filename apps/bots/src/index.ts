export { Bot, type BotOptions, type RoundSummary } from "./bot.js";
export { type DemoOptions, type DemoResult, runDemo, spectatorUrlFor } from "./demo.js";
export { DRAWINGS, LIBRARY_WORDS } from "./library/drawings.js";
export { generateLibrary } from "./library/generate.js";
export { libraryDir, placeholderDrawing, slug, StrokeLibrary } from "./library/loader.js";
export * as shapes from "./library/shapes.js";
export { type RaceOptions, type RaceResult, runRace } from "./race.js";
export { animateOps, type DrawerStrategy, LibraryDrawer } from "./strategies/drawer.js";
export {
  type GuessContext,
  type GuesserStrategy,
  OracleGuesser,
  oracleWordFromEnv,
  PatternGuesser,
  POOL_WORDS,
  RandomPoolGuesser,
  wordsMatchingPattern,
} from "./strategies/guesser.js";
export {
  buildPrompt,
  chatWithImage,
  DEFAULT_LLM_BASE,
  DEFAULT_LLM_MODEL,
  LlmGuesser,
  parseGuess,
} from "./strategies/llm.js";
export { jittered, pick, seededRng, sleep } from "./util.js";

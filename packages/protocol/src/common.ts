import { z } from "zod";

export const GameId = z.literal("pictionary");
export type GameId = z.infer<typeof GameId>;

export const RoomStatus = z.enum(["lobby", "playing", "finished"]);
export type RoomStatus = z.infer<typeof RoomStatus>;

export const RoundPhase = z.enum(["choosing", "drawing", "reveal"]);
export type RoundPhase = z.infer<typeof RoundPhase>;

export const Role = z.enum(["agent", "human", "spectator"]);
export type Role = z.infer<typeof Role>;

export const GuessSource = z.enum(["agent", "human"]);
export type GuessSource = z.infer<typeof GuessSource>;

export const GuessResult = z.enum(["correct", "incorrect", "close", "late", "round_over"]);
export type GuessResult = z.infer<typeof GuessResult>;

export const RoundEndReason = z.enum(["guessed", "timeout", "exhausted", "drawer_left"]);
export type RoundEndReason = z.infer<typeof RoundEndReason>;

export const Difficulty = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof Difficulty>;

export const WordSource = z.enum(["pool", "custom"]);
export type WordSource = z.infer<typeof WordSource>;

export const Tier = z.enum(["free", "paid"]);
export type Tier = z.infer<typeof Tier>;

/** Opaque ids are strings (UUIDs from the server). */
export const Id = z.string().min(1).max(64);

/** 6-char room code, uppercase letters/digits without look-alikes. */
export const RoomCode = z.string().regex(/^[A-HJ-NP-Z2-9]{4,8}$/);
export type RoomCode = z.infer<typeof RoomCode>;

/** Pictionary room configuration. All durations in seconds. */
export const PictionaryConfig = z.object({
  roundsPerPlayer: z.number().int().min(1).max(5).default(1),
  chooseSeconds: z.number().min(1).max(120).default(20),
  drawSeconds: z.number().min(1).max(600).default(90),
  revealSeconds: z.number().min(0).max(60).default(5),
  guessesPerAgent: z.number().int().min(1).max(10).default(3),
  humanGuessesPerRound: z.number().int().min(0).max(10).default(3),
  firstCorrectEnds: z.boolean().default(true),
  minPlayers: z.number().int().min(2).max(8).default(2),
  maxPlayers: z.number().int().min(2).max(8).default(8),
  /** Drawer disconnected for longer than this during `drawing` -> round skipped. */
  drawerGraceMs: z.number().int().min(0).default(10_000),
});
export type PictionaryConfig = z.infer<typeof PictionaryConfig>;
export type PictionaryConfigInput = z.input<typeof PictionaryConfig>;

export const ScoreEntry = z.object({
  points: z.number().int(),
  agentPoints: z.number().int(),
  humanPoints: z.number().int(),
});
export type ScoreEntry = z.infer<typeof ScoreEntry>;

/** agentId -> score. */
export const ScoreTable = z.record(Id, ScoreEntry);
export type ScoreTable = z.infer<typeof ScoreTable>;

export const PlayerInfo = z.object({
  agentId: Id,
  name: z.string(),
  ready: z.boolean(),
  connected: z.boolean(),
  humans: z.number().int().nonnegative(),
});
export type PlayerInfo = z.infer<typeof PlayerInfo>;

export const WordOption = z.object({
  index: z.number().int().min(0).max(2),
  word: z.string(),
  difficulty: Difficulty,
});
export type WordOption = z.infer<typeof WordOption>;

export const GuessFeedItem = z.object({
  seq: z.number().int().nonnegative(),
  agentId: Id,
  source: GuessSource,
  text: z.string(),
  result: GuessResult,
});
export type GuessFeedItem = z.infer<typeof GuessFeedItem>;

export const Winner = z.object({
  agentId: Id,
  source: GuessSource,
  seq: z.number().int().nonnegative(),
});
export type Winner = z.infer<typeof Winner>;

export const PROTOCOL_VERSION = 1;

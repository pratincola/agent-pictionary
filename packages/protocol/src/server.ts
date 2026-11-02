import { z } from "zod";
import {
  GameId,
  GuessFeedItem,
  GuessResult,
  Id,
  PictionaryConfig,
  PlayerInfo,
  Role,
  RoomCode,
  RoomStatus,
  RoundEndReason,
  RoundPhase,
  ScoreTable,
  Winner,
  WordOption,
} from "./common.js";
import { DrawOp, OpLogEntry } from "./draw.js";
import { ErrorPayload } from "./errors.js";

/** Fields every server -> client envelope carries. */
const envelope = {
  /** Per-room monotonically increasing seq of the actor event that produced this message. */
  seq: z.number().int().nonnegative(),
  /** Server wall clock in ms. */
  ts: z.number().int().nonnegative(),
  /** Set on replies to a client message (its `id`). */
  replyTo: z.string().optional(),
};

// ---------------------------------------------------------------------------
// room.state snapshot (redacted per viewer; see PLAN.md §11)
// ---------------------------------------------------------------------------

export const RoundSnapshot = z.object({
  phase: RoundPhase,
  roundIndex: z.number().int().nonnegative(),
  drawerAgentId: Id,
  /** Absolute ms when the current phase ends. */
  deadline: z.number().int().nonnegative(),
  /** Drawer during choosing/drawing; everyone during reveal. */
  word: z.string().optional(),
  wordPattern: z.string(),
  /** Drawer only, during `choosing` (so a reconnecting drawer can still pick). */
  options: z.array(WordOption).optional(),
  /** Full op log; use GET /rooms/:code/ops?after= for deltas. */
  ops: z.array(OpLogEntry),
  /** Agents and humans: guesses this viewer may still submit this round. */
  myGuessesRemaining: z.number().int().nonnegative().optional(),
  /** Drawer agent only. */
  wrongGuesses: z.number().int().nonnegative().optional(),
  /** Humans and spectators only. Never agents. */
  feed: z.array(GuessFeedItem).optional(),
});
export type RoundSnapshot = z.infer<typeof RoundSnapshot>;

export const MatchSnapshot = z.object({
  matchId: Id,
  roundIndex: z.number().int().nonnegative(),
  roundsTotal: z.number().int().positive(),
  order: z.array(Id),
  scores: ScoreTable,
});
export type MatchSnapshot = z.infer<typeof MatchSnapshot>;

export const Viewer = z.object({
  sessionId: Id,
  role: Role,
  /** Agent sessions: own id. Human sessions: the paired agent (if any). */
  agentId: Id.optional(),
  humanId: Id.optional(),
});
export type Viewer = z.infer<typeof Viewer>;

export const RoomStateSnapshot = z.object({
  code: RoomCode,
  gameId: GameId,
  status: RoomStatus,
  players: z.array(PlayerInfo),
  config: PictionaryConfig,
  match: MatchSnapshot.optional(),
  round: RoundSnapshot.optional(),
  /** Last seq this snapshot includes. */
  seq: z.number().int().nonnegative(),
  /** Who the server thinks you are. */
  you: Viewer,
});
export type RoomStateSnapshot = z.infer<typeof RoomStateSnapshot>;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export const PlayerEventPayload = z.object({
  agentId: Id,
  name: z.string(),
  humans: z.number().int().nonnegative(),
});
export const MatchStartedPayload = z.object({
  matchId: Id,
  order: z.array(Id),
  roundsTotal: z.number().int().positive(),
});
export const RoundChoosingPayload = z.object({
  roundIndex: z.number().int().nonnegative(),
  drawerAgentId: Id,
  deadline: z.number().int().nonnegative(),
});
export const RoundWordOptionsPayload = z.object({ options: z.array(WordOption).length(3) });
export const HumanNoteRelayPayload = z.object({ text: z.string() });
export const RoundStartedPayload = z.object({
  roundIndex: z.number().int().nonnegative(),
  drawerAgentId: Id,
  deadline: z.number().int().nonnegative(),
  wordLength: z.number().int().positive(),
  wordPattern: z.string(),
});
export const DrawOpBroadcastPayload = z.object({ opSeq: z.number().int().positive(), op: DrawOp });
export const DrawErasedPayload = z.object({ opSeq: z.number().int().positive() });
export const GuessResultPayload = z.object({
  result: GuessResult,
  remaining: z.number().int().nonnegative(),
});
export const GuessCountPayload = z.object({ wrongGuesses: z.number().int().nonnegative() });
export const RoundEndedPayload = z.object({
  roundIndex: z.number().int().nonnegative(),
  word: z.string(),
  reason: RoundEndReason,
  winner: Winner.optional(),
  /** Cumulative match scores after this round. */
  scores: ScoreTable,
  /** Points awarded in this round only. */
  roundScores: ScoreTable,
});
export const MatchEndedPayload = z.object({
  matchId: Id,
  scores: ScoreTable,
  winnerAgentId: Id.optional(),
});
export const AckPayload = z.object({
  /** For draw.ops: the opSeq range assigned to the message. */
  opSeqFrom: z.number().int().positive().optional(),
  opSeqTo: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const msg = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ type: z.literal(type), ...envelope, payload });

export const RoomStateMessage = msg("room.state", RoomStateSnapshot);
export const RoomPlayerJoinedMessage = msg("room.playerJoined", PlayerEventPayload);
export const RoomPlayerLeftMessage = msg("room.playerLeft", PlayerEventPayload);
export const MatchStartedMessage = msg("match.started", MatchStartedPayload);
export const RoundChoosingMessage = msg("round.choosing", RoundChoosingPayload);
export const RoundWordOptionsMessage = msg("round.wordOptions", RoundWordOptionsPayload);
export const HumanNoteRelayMessage = msg("human.note", HumanNoteRelayPayload);
export const RoundStartedMessage = msg("round.started", RoundStartedPayload);
export const DrawOpMessage = msg("draw.op", DrawOpBroadcastPayload);
export const DrawErasedMessage = msg("draw.erased", DrawErasedPayload);
export const DrawClearedMessage = msg("draw.cleared", z.object({}));
export const GuessResultMessage = msg("guess.result", GuessResultPayload);
export const GuessFeedMessage = msg("guess.feed", GuessFeedItem);
export const GuessCountMessage = msg("guess.count", GuessCountPayload);
export const RoundEndedMessage = msg("round.ended", RoundEndedPayload);
export const MatchEndedMessage = msg("match.ended", MatchEndedPayload);
export const ErrorMessage = msg("error", ErrorPayload);
export const PongMessage = msg("pong", z.object({}));
export const AckMessage = msg("ack", AckPayload);

export const ServerMessage = z.discriminatedUnion("type", [
  RoomStateMessage,
  RoomPlayerJoinedMessage,
  RoomPlayerLeftMessage,
  MatchStartedMessage,
  RoundChoosingMessage,
  RoundWordOptionsMessage,
  HumanNoteRelayMessage,
  RoundStartedMessage,
  DrawOpMessage,
  DrawErasedMessage,
  DrawClearedMessage,
  GuessResultMessage,
  GuessFeedMessage,
  GuessCountMessage,
  RoundEndedMessage,
  MatchEndedMessage,
  ErrorMessage,
  PongMessage,
  AckMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type ServerMessageType = ServerMessage["type"];
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

/**
 * A server message before the transport stamps `seq`/`ts`. The engine emits
 * these; the room actor fills in the envelope.
 */
export type ServerMessageBody = {
  [T in ServerMessageType]: { type: T; payload: ServerMessageOf<T>["payload"]; replyTo?: string };
}[ServerMessageType];

/** Message types that must never be delivered to an agent session (PLAN.md §11). */
export const AGENT_FORBIDDEN_MESSAGE_TYPES: ReadonlySet<ServerMessageType> =
  new Set<ServerMessageType>(["guess.feed"]);

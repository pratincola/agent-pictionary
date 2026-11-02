import type {
  ClientMessage,
  Entitlement,
  ErrorCode,
  GameId,
  PictionaryConfig,
  PlayerInfo,
  Role,
  ServerMessageBody,
  Viewer,
} from "@pictionary/protocol";
import type { RngState } from "./rng.js";

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** What the server knows about a socket when it joins the room. */
export interface SessionInfo {
  sessionId: string;
  role: Role;
  /** Agent sessions: own id. Human sessions: paired agent, if any. */
  agentId?: string;
  agentName?: string;
  humanId?: string;
  /** Agent sessions only. */
  entitlements?: Entitlement[];
  /** True when this session (or its agent/human) created the room. */
  creator?: boolean;
}

// ---------------------------------------------------------------------------
// Events (input). Time and randomness enter only through these.
// ---------------------------------------------------------------------------

interface EventBase {
  /** Per-room sequence assigned by the actor on dequeue. The truth for ordering. */
  seq: number;
  /** Wall clock in ms when the actor dequeued the event. */
  now: number;
}

export type RoomEvent =
  | (EventBase & { kind: "session.join"; session: SessionInfo })
  | (EventBase & { kind: "session.leave"; sessionId: string })
  | (EventBase & {
      kind: "client";
      sessionId: string;
      message: ClientMessage;
      /** process.hrtime.bigint() at socket receipt, as a decimal string. Informational. */
      recvNs?: string;
    })
  | (EventBase & { kind: "tick"; timerId: string })
  | (EventBase & { kind: "agent.entitlements"; agentId: string; entitlements: Entitlement[] });

export type RoomEventKind = RoomEvent["kind"];

// ---------------------------------------------------------------------------
// Effects (output). Data only; the server executes them.
// ---------------------------------------------------------------------------

export type SessionTarget = { sessionId: string } | { agentId: string } | { humansOfAgent: string };

export type Audience = "all" | "humans" | "agents" | "spectators" | "non_agents";

export type Effect =
  | { kind: "send"; to: SessionTarget; message: ServerMessageBody }
  | { kind: "broadcast"; audience: Audience; message: ServerMessageBody }
  | { kind: "persist"; record: PersistRecord }
  | { kind: "schedule"; at: number; timerId: string }
  | { kind: "close"; sessionId: string; code: ErrorCode; message: string };

// ---------------------------------------------------------------------------
// Persistence records
// ---------------------------------------------------------------------------

export interface GuessRecord {
  seq: number;
  agentId: string;
  humanId?: string;
  source: "agent" | "human";
  text: string;
  normalized: string;
  result: "correct" | "incorrect" | "close" | "late" | "round_over";
  recvNs?: string;
  clientTs: number;
}

export type PersistRecord =
  | {
      type: "match.started";
      matchId: string;
      startedAt: number;
      order: string[];
      roundsTotal: number;
    }
  | {
      type: "round.ended";
      matchId: string;
      roundIndex: number;
      drawerAgentId: string;
      word: string;
      wordSource: "pool" | "custom";
      startedAt: number;
      endedAt: number;
      reason: "guessed" | "timeout" | "exhausted" | "drawer_left";
      winner?: {
        agentId: string;
        humanId?: string;
        source: "agent" | "human";
        seq: number;
        recvNs?: string;
      };
      guesses: GuessRecord[];
      ops: import("@pictionary/protocol").OpLogEntry[];
      roundScores: import("@pictionary/protocol").ScoreTable;
      scores: import("@pictionary/protocol").ScoreTable;
    }
  | {
      type: "match.ended";
      matchId: string;
      endedAt: number;
      scores: import("@pictionary/protocol").ScoreTable;
      winnerAgentId?: string;
      roundsDrawn: Record<string, number>;
      roundsWon: Record<string, number>;
    };

// ---------------------------------------------------------------------------
// GameModule
// ---------------------------------------------------------------------------

/** A player as the game module sees it. */
export interface GamePlayer {
  agentId: string;
  name: string;
  entitlements: Entitlement[];
  connected: boolean;
  /** Connected human sessions paired to this agent. */
  humans: number;
}

/** Events the room forwards to the game module. */
export type GameEvent =
  | (EventBase & { kind: "match.start"; matchId: string })
  | (EventBase & { kind: "client"; session: SessionInfo; message: ClientMessage; recvNs?: string })
  | (EventBase & { kind: "tick"; timerId: string })
  | (EventBase & { kind: "player.connected"; agentId: string })
  | (EventBase & { kind: "player.disconnected"; agentId: string })
  | (EventBase & { kind: "humans.changed"; agentId: string; humans: number })
  | (EventBase & { kind: "player.entitlements"; agentId: string; entitlements: Entitlement[] });

export interface StepResult<S> {
  state: S;
  effects: Effect[];
}

/**
 * A game the room can host. Pure: no I/O, no clocks, no Math.random.
 * `S` is the game state, `E` the event type (RoomEvent-derived).
 */
export interface GameModule<S, E = GameEvent, V = unknown> {
  readonly id: GameId;
  init(config: PictionaryConfig, players: GamePlayer[], rng: RngState): S;
  handle(state: S, event: E): StepResult<S>;
  /** Redacted view for one viewer (PLAN.md §11). */
  view(state: S, viewer: Viewer): V;
  /** True once the match is over. The room moves to `finished`. */
  isFinished(state: S): boolean;
}

export type { PlayerInfo, Viewer };

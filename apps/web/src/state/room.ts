import type {
  ErrorPayload,
  GuessFeedItem,
  GuessResult,
  OpLogEntry,
  PlayerInfo,
  RoomStateSnapshot,
  RoundSnapshot,
  ScoreTable,
  ServerMessage,
  ServerMessageOf,
} from "@pictionary/protocol";
import { emptyOpLog, type OpLogState, opLogReducer } from "./opLog.js";

export type RoundEnd = ServerMessageOf<"round.ended">["payload"];
export type MatchEnd = ServerMessageOf<"match.ended">["payload"];

export interface MyGuessResult {
  result: GuessResult;
  remaining: number;
  text: string;
}

export interface InlineError extends ErrorPayload {
  replyTo?: string;
  at: number;
}

/** Everything the room page renders, derived from the snapshot plus live messages. */
export interface RoomViewState {
  readonly snap: RoomStateSnapshot | null;
  /** Op log of the current round; `snap.round.ops` is not kept up to date. */
  readonly opLog: OpLogState;
  /** Guess feed of the current round; `snap.round.feed` is not kept up to date. */
  readonly feed: readonly GuessFeedItem[];
  readonly roundEnd: RoundEnd | null;
  readonly matchEnd: MatchEnd | null;
  /** Points awarded in the last finished round, shown briefly in the scoreboard. */
  readonly lastDeltas: ScoreTable | null;
  readonly myLastResult: MyGuessResult | null;
  readonly lastError: InlineError | null;
  /** Last server seq seen. */
  readonly seq: number;
}

export const initialRoomView: RoomViewState = {
  snap: null,
  opLog: emptyOpLog,
  feed: [],
  roundEnd: null,
  matchEnd: null,
  lastDeltas: null,
  myLastResult: null,
  lastError: null,
  seq: 0,
};

export type RoomViewAction =
  | { type: "message"; msg: ServerMessage; localNow: number; pendingText?: string }
  | { type: "players"; players: PlayerInfo[] }
  | { type: "merge-ops"; ops: readonly OpLogEntry[] }
  | { type: "clear-error" }
  | { type: "local-error"; error: ErrorPayload; localNow: number };

export function roomReducer(state: RoomViewState, action: RoomViewAction): RoomViewState {
  switch (action.type) {
    case "players":
      return state.snap ? { ...state, snap: { ...state.snap, players: action.players } } : state;
    case "merge-ops":
      return { ...state, opLog: opLogReducer(state.opLog, { type: "merge", ops: action.ops }) };
    case "clear-error":
      return state.lastError ? { ...state, lastError: null } : state;
    case "local-error":
      return { ...state, lastError: { ...action.error, at: action.localNow } };
    case "message":
      return applyMessage(state, action.msg, action.localNow, action.pendingText);
  }
}

function applyMessage(
  state: RoomViewState,
  msg: ServerMessage,
  localNow: number,
  pendingText: string | undefined,
): RoomViewState {
  const seq = Math.max(state.seq, msg.seq);
  switch (msg.type) {
    case "room.state": {
      const snap = msg.payload;
      const next: RoomViewState = {
        ...state,
        seq: snap.seq,
        snap,
        opLog: opLogReducer(state.opLog, { type: "snapshot", ops: snap.round?.ops ?? [] }),
        feed: snap.round?.feed ?? [],
        // A snapshot in `reveal` has the word but not the winner; the overlay copes.
        roundEnd:
          snap.round?.phase === "reveal" && state.roundEnd?.roundIndex === snap.round.roundIndex
            ? state.roundEnd
            : null,
        matchEnd: snap.status === "finished" ? state.matchEnd : null,
      };
      return next;
    }
    case "room.playerJoined": {
      if (!state.snap) return state;
      const { agentId, name, humans } = msg.payload;
      const exists = state.snap.players.some((p) => p.agentId === agentId);
      const players = exists
        ? state.snap.players.map((p) =>
            p.agentId === agentId ? { ...p, name, humans, connected: true } : p,
          )
        : [...state.snap.players, { agentId, name, humans, ready: false, connected: true }];
      return { ...state, seq, snap: { ...state.snap, players } };
    }
    case "room.playerLeft": {
      if (!state.snap) return state;
      const players = state.snap.players.filter((p) => p.agentId !== msg.payload.agentId);
      return { ...state, seq, snap: { ...state.snap, players } };
    }
    case "match.started": {
      if (!state.snap) return state;
      const scores: ScoreTable = {};
      for (const id of msg.payload.order)
        scores[id] = { points: 0, agentPoints: 0, humanPoints: 0 };
      return {
        ...state,
        seq,
        matchEnd: null,
        roundEnd: null,
        lastDeltas: null,
        snap: {
          ...state.snap,
          status: "playing",
          match: {
            matchId: msg.payload.matchId,
            roundIndex: 0,
            roundsTotal: msg.payload.roundsTotal,
            order: msg.payload.order,
            scores,
          },
        },
      };
    }
    case "round.choosing": {
      if (!state.snap) return state;
      const { roundIndex, drawerAgentId, deadline } = msg.payload;
      const round: RoundSnapshot = {
        phase: "choosing",
        roundIndex,
        drawerAgentId,
        deadline,
        wordPattern: "",
        ops: [],
      };
      return {
        ...state,
        seq,
        roundEnd: null,
        myLastResult: null,
        lastError: null,
        feed: [],
        opLog: opLogReducer(state.opLog, { type: "reset" }),
        snap: {
          ...state.snap,
          round,
          match: state.snap.match ? { ...state.snap.match, roundIndex } : state.snap.match,
        },
      };
    }
    case "round.started": {
      if (!state.snap) return state;
      const { roundIndex, drawerAgentId, deadline, wordPattern } = msg.payload;
      const prev = state.snap.round;
      const base: RoundSnapshot =
        prev && prev.roundIndex === roundIndex
          ? prev
          : { phase: "drawing", roundIndex, drawerAgentId, deadline, wordPattern, ops: [] };
      const round: RoundSnapshot = {
        ...base,
        phase: "drawing",
        roundIndex,
        drawerAgentId,
        deadline,
        wordPattern,
        ops: [],
      };
      delete round.word;
      delete round.options;
      const you = state.snap.you;
      if (you.role === "human" && you.agentId && you.agentId !== drawerAgentId) {
        round.myGuessesRemaining = state.snap.config.humanGuessesPerRound;
      } else {
        delete round.myGuessesRemaining;
      }
      return {
        ...state,
        seq,
        roundEnd: null,
        snap: {
          ...state.snap,
          round,
          match: state.snap.match ? { ...state.snap.match, roundIndex } : state.snap.match,
        },
      };
    }
    case "draw.op":
      return {
        ...state,
        seq,
        opLog: opLogReducer(state.opLog, {
          type: "op",
          opSeq: msg.payload.opSeq,
          op: msg.payload.op,
        }),
      };
    case "draw.erased":
      return {
        ...state,
        seq,
        opLog: opLogReducer(state.opLog, { type: "erased", opSeq: msg.payload.opSeq }),
      };
    case "draw.cleared":
      return { ...state, seq, opLog: opLogReducer(state.opLog, { type: "cleared" }) };
    case "guess.feed": {
      if (state.feed.some((f) => f.seq === msg.payload.seq)) return { ...state, seq };
      return { ...state, seq, feed: [...state.feed, msg.payload] };
    }
    case "guess.result": {
      const my: MyGuessResult = {
        result: msg.payload.result,
        remaining: msg.payload.remaining,
        text: pendingText ?? "",
      };
      let snap = state.snap;
      if (snap?.round && snap.you.role === "human") {
        snap = { ...snap, round: { ...snap.round, myGuessesRemaining: msg.payload.remaining } };
      }
      return { ...state, seq, snap, myLastResult: my, lastError: null };
    }
    case "round.ended": {
      if (!state.snap) return state;
      const p = msg.payload;
      const revealMs = state.snap.config.revealSeconds * 1000;
      const round: RoundSnapshot | undefined = state.snap.round
        ? {
            ...state.snap.round,
            phase: "reveal",
            word: p.word,
            // round.ended carries no deadline; the reveal lasts config.revealSeconds.
            deadline: msg.ts + revealMs,
          }
        : undefined;
      return {
        ...state,
        seq,
        roundEnd: p,
        lastDeltas: p.roundScores,
        snap: {
          ...state.snap,
          ...(round ? { round } : {}),
          match: state.snap.match ? { ...state.snap.match, scores: p.scores } : state.snap.match,
        },
      };
    }
    case "match.ended": {
      if (!state.snap) return state;
      return {
        ...state,
        seq,
        matchEnd: msg.payload,
        snap: {
          ...state.snap,
          status: "finished",
          match: state.snap.match
            ? { ...state.snap.match, scores: msg.payload.scores }
            : state.snap.match,
        },
      };
    }
    case "error":
      return {
        ...state,
        seq,
        lastError: {
          ...msg.payload,
          ...(msg.replyTo !== undefined ? { replyTo: msg.replyTo } : {}),
          at: localNow,
        },
      };
    case "round.wordOptions":
    case "human.note":
    case "guess.count":
    case "pong":
    case "ack":
      return { ...state, seq };
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export type Phase = "connecting" | "lobby" | "choosing" | "drawing" | "reveal" | "finished";

export function phaseOf(state: RoomViewState): Phase {
  const snap = state.snap;
  if (!snap) return "connecting";
  if (snap.status === "finished") return "finished";
  if (snap.status === "lobby") return "lobby";
  return snap.round?.phase ?? "choosing";
}

export function playerName(snap: RoomStateSnapshot | null, agentId: string | undefined): string {
  if (!agentId) return "?";
  return snap?.players.find((p) => p.agentId === agentId)?.name ?? agentId.slice(0, 8);
}

export function drawerId(state: RoomViewState): string | undefined {
  return state.snap?.round?.drawerAgentId;
}

/** Paired human: the agent this human coaches. */
export function myAgentId(state: RoomViewState): string | undefined {
  const you = state.snap?.you;
  return you?.role === "human" ? you.agentId : undefined;
}

export function isPairedHuman(state: RoomViewState): boolean {
  return myAgentId(state) !== undefined;
}

export function isDrawersHuman(state: RoomViewState): boolean {
  const me = myAgentId(state);
  return me !== undefined && me === drawerId(state);
}

/**
 * Agent guesses spent this round, from the public feed. Humans do not receive
 * their agent's `guess.result`, but every agent guess shows up in `guess.feed`.
 */
export function agentGuessesUsed(state: RoomViewState, agentId: string): number {
  let n = 0;
  for (const f of state.feed) {
    if (f.agentId !== agentId || f.source !== "agent") continue;
    if (f.result === "late" || f.result === "round_over") continue;
    n++;
  }
  return n;
}

export function agentGuessesRemaining(state: RoomViewState, agentId: string): number {
  const per = state.snap?.config.guessesPerAgent ?? 3;
  return Math.max(0, per - agentGuessesUsed(state, agentId));
}

export interface HumanGuessGate {
  enabled: boolean;
  reason: string;
}

/** Why the human guess box is enabled or not. Mirrors the engine's `handleGuess` checks. */
export function humanGuessGate(state: RoomViewState): HumanGuessGate {
  const me = myAgentId(state);
  if (!me) return { enabled: false, reason: "Not paired to an agent" };
  const phase = phaseOf(state);
  if (phase === "lobby") return { enabled: false, reason: "Waiting for the match to start" };
  if (phase === "choosing") return { enabled: false, reason: "The drawer is choosing a word" };
  if (phase === "reveal") return { enabled: false, reason: "Round over" };
  if (phase === "finished") return { enabled: false, reason: "Match over" };
  if (phase === "connecting") return { enabled: false, reason: "Connecting" };
  if (me === drawerId(state)) return { enabled: false, reason: "Your agent is drawing" };
  if (state.feed.some((f) => f.agentId === me && f.result === "correct")) {
    return { enabled: false, reason: "Your team already found the word" };
  }
  const agentLeft = agentGuessesRemaining(state, me);
  if (agentLeft > 0) {
    return {
      enabled: false,
      reason: `Your agent still has ${agentLeft} ${agentLeft === 1 ? "guess" : "guesses"}`,
    };
  }
  const mine = state.snap?.round?.myGuessesRemaining ?? 0;
  if (mine <= 0) return { enabled: false, reason: "No human guesses left this round" };
  return { enabled: true, reason: `${mine} ${mine === 1 ? "guess" : "guesses"} left` };
}

/** Players sorted by cumulative points (desc), then drawer order. */
export function standings(state: RoomViewState): (PlayerInfo & { points: number })[] {
  const snap = state.snap;
  if (!snap) return [];
  const scores = snap.match?.scores ?? {};
  const order = snap.match?.order ?? snap.players.map((p) => p.agentId);
  const rows = snap.players.map((p) => ({ ...p, points: scores[p.agentId]?.points ?? 0 }));
  rows.sort((a, b) => b.points - a.points || order.indexOf(a.agentId) - order.indexOf(b.agentId));
  return rows;
}

/**
 * Client-side room state: the last `room.state` snapshot kept in sync by
 * applying every incremental server message. Pure: `reduce(state, msg)`
 * returns a new state and never mutates its input.
 */
import type {
  OpLogEntry,
  PlayerInfo,
  RoomStateSnapshot,
  ServerMessage,
  ServerMessageOf,
} from "@pictionary/protocol";

export type RoundEndedPayload = ServerMessageOf<"round.ended">["payload"];

export interface AgentState extends RoomStateSnapshot {
  /** Last `round.ended` payload seen (survives into the next round's `choosing`). */
  lastRoundEnded?: RoundEndedPayload;
  /** `human.note` texts received this round (drawer only). */
  notes: string[];
  /** Sum of `draw.op` broadcasts since the snapshot (stats/debug). */
  opsReceived: number;
}

export function fromSnapshot(snap: RoomStateSnapshot, prev?: AgentState): AgentState {
  const out: AgentState = { ...snap, notes: [], opsReceived: prev?.opsReceived ?? 0 };
  if (prev?.lastRoundEnded) out.lastRoundEnded = prev.lastRoundEnded;
  return out;
}

function withPlayer(
  players: PlayerInfo[],
  agentId: string,
  patch: (p: PlayerInfo | undefined) => PlayerInfo,
): PlayerInfo[] {
  const i = players.findIndex((p) => p.agentId === agentId);
  if (i < 0) return [...players, patch(undefined)];
  const next = players.slice();
  next[i] = patch(players[i]);
  return next;
}

/** Apply one server message. `room.state` replaces everything else. */
export function reduce(state: AgentState | undefined, msg: ServerMessage): AgentState | undefined {
  if (msg.type === "room.state") return fromSnapshot(msg.payload, state);
  if (!state) return state;
  const s: AgentState = { ...state, seq: Math.max(state.seq, msg.seq) };
  switch (msg.type) {
    case "room.playerJoined": {
      const { agentId, name, humans } = msg.payload;
      s.players = withPlayer(s.players, agentId, (p) => ({
        agentId,
        name,
        ready: p?.ready ?? false,
        connected: true,
        humans,
      }));
      return s;
    }
    case "room.playerLeft": {
      const { agentId, name, humans } = msg.payload;
      s.players = withPlayer(s.players, agentId, (p) => ({
        agentId,
        name,
        ready: p?.ready ?? false,
        connected: false,
        humans,
      }));
      return s;
    }
    case "match.started":
      s.status = "playing";
      s.match = {
        matchId: msg.payload.matchId,
        roundIndex: 0,
        roundsTotal: msg.payload.roundsTotal,
        order: msg.payload.order,
        scores: {},
      };
      return s;
    case "round.choosing": {
      const { roundIndex, drawerAgentId, deadline } = msg.payload;
      s.round = {
        phase: "choosing",
        roundIndex,
        drawerAgentId,
        deadline,
        wordPattern: "",
        ops: [],
      };
      if (s.match) s.match = { ...s.match, roundIndex };
      s.notes = [];
      return s;
    }
    case "round.wordOptions":
      if (s.round) s.round = { ...s.round, options: msg.payload.options };
      return s;
    case "human.note":
      s.notes = [...s.notes, msg.payload.text];
      return s;
    case "round.started": {
      const { roundIndex, drawerAgentId, deadline, wordPattern } = msg.payload;
      const prev = s.round && s.round.roundIndex === roundIndex ? s.round : undefined;
      const { options: _opts, ...keep } = prev ?? { ops: [] as OpLogEntry[] };
      s.round = {
        ...keep,
        phase: "drawing",
        roundIndex,
        drawerAgentId,
        deadline,
        wordPattern,
        ops: prev?.ops ?? [],
      };
      if (s.you.role === "agent" && s.you.agentId !== drawerAgentId) {
        s.round.myGuessesRemaining = prev?.myGuessesRemaining ?? s.config.guessesPerAgent;
      }
      if (s.you.role === "agent" && s.you.agentId === drawerAgentId) s.round.wrongGuesses = 0;
      if (s.match) s.match = { ...s.match, roundIndex };
      return s;
    }
    case "draw.op": {
      if (!s.round) return s;
      const { opSeq, op } = msg.payload;
      // Ignore duplicates (reconnect race between snapshot and live stream).
      if (s.round.ops.some((e) => e.opSeq === opSeq)) return s;
      s.round = { ...s.round, ops: [...s.round.ops, { opSeq, op }] };
      s.opsReceived += 1;
      return s;
    }
    case "draw.erased": {
      if (!s.round) return s;
      const { opSeq } = msg.payload;
      s.round = {
        ...s.round,
        ops: s.round.ops.map((e) => (e.opSeq === opSeq ? { ...e, erased: true } : e)),
      };
      return s;
    }
    case "draw.cleared":
      if (!s.round) return s;
      s.round = {
        ...s.round,
        ops: s.round.ops.map((e) => (e.erased ? e : { ...e, erased: true })),
      };
      return s;
    case "guess.result":
      if (s.round) s.round = { ...s.round, myGuessesRemaining: msg.payload.remaining };
      return s;
    case "guess.count":
      if (s.round) s.round = { ...s.round, wrongGuesses: msg.payload.wrongGuesses };
      return s;
    case "round.ended": {
      s.lastRoundEnded = msg.payload;
      if (s.round) s.round = { ...s.round, phase: "reveal", word: msg.payload.word };
      if (s.match) s.match = { ...s.match, scores: msg.payload.scores };
      return s;
    }
    case "match.ended":
      s.status = "finished";
      if (s.match) s.match = { ...s.match, scores: msg.payload.scores };
      return s;
    default:
      return s;
  }
}

/**
 * The drawer learns its word from `word.choose`/`word.custom`, not from a
 * server message (`round.started` carries only the pattern). Record it so
 * `state.round.word` is set for the drawer during `drawing`.
 */
export function setChosenWord(state: AgentState | undefined, word: string): AgentState | undefined {
  if (!state?.round || state.round.phase === "reveal") return state;
  if (state.you.agentId !== state.round.drawerAgentId) return state;
  return { ...state, round: { ...state.round, word } };
}

/** Ops that are currently visible (not erased). */
export function visibleOpLog(state: AgentState | undefined): OpLogEntry[] {
  return state?.round?.ops.filter((e) => !e.erased) ?? [];
}

/** Highest opSeq in the log, 0 when empty. */
export function lastOpSeq(state: AgentState | undefined): number {
  const ops = state?.round?.ops;
  if (!ops || ops.length === 0) return 0;
  return ops[ops.length - 1]?.opSeq ?? 0;
}

/** Whole seconds until the current phase deadline (0 when passed or no round). */
export function secondsLeft(state: AgentState | undefined, now = Date.now()): number {
  if (!state?.round) return 0;
  return Math.max(0, Math.ceil((state.round.deadline - now) / 1000));
}

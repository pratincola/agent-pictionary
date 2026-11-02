import {
  type ClientMessage,
  type Entitlement,
  type ErrorCode,
  type GuessFeedItem,
  type GuessResult,
  type MatchSnapshot,
  matchGuess,
  normalizeGuess,
  type OpLogEntry,
  type PictionaryConfig,
  type RoundEndReason,
  type RoundPhase,
  type RoundSnapshot,
  type ScoreEntry,
  type ScoreTable,
  type ServerMessageBody,
  type WordOption,
  type WordSource,
  wordPattern,
} from "@pictionary/protocol";
import { type RngState, rngInt } from "./rng.js";
import type {
  Effect,
  GameEvent,
  GameModule,
  GamePlayer,
  GuessRecord,
  SessionInfo,
  SessionTarget,
  StepResult,
} from "./types.js";
import { pickWordOptions, validateCustomWord, type WordEntry } from "./words/index.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RoundEnd {
  reason: RoundEndReason;
  winner?: {
    agentId: string;
    humanId?: string;
    source: "agent" | "human";
    seq: number;
    recvNs?: string;
  };
  endedAt: number;
}

export interface PictionaryRound {
  index: number;
  drawerAgentId: string;
  phase: RoundPhase;
  /** Absolute ms when the current phase ends. */
  deadline: number;
  /** Timer id that ends the current phase. Stale ticks carry a different id. */
  phaseTimer: string;
  /** Set while the drawer is disconnected during choosing/drawing. */
  graceTimer?: string;
  startedAt: number;
  drawingStartedAt?: number;
  /** Offered words (internal; aliases included). Drawer only. */
  options?: WordEntry[];
  word?: string;
  aliases: string[];
  wordSource: WordSource;
  ops: OpLogEntry[];
  nextOpSeq: number;
  guesses: GuessRecord[];
  agentGuessesLeft: Record<string, number>;
  humanGuessesLeft: Record<string, number>;
  /** Guessers (agentId) that already found the word (firstCorrectEnds=false). */
  solved: Record<string, true>;
  wrongGuesses: number;
  /** firstCorrectEnds=false: the first solver, scored when the round ends. */
  firstWinner?: { winner: NonNullable<RoundEnd["winner"]>; secondsLeft: number };
  ended?: RoundEnd;
}

export interface PictionaryState {
  config: PictionaryConfig;
  status: "waiting" | "running" | "ended";
  matchId: string | null;
  players: Record<string, GamePlayer>;
  /** Drawer rotation. Fixed at match start. */
  order: string[];
  roundsTotal: number;
  /** Index of the current (or last) round; -1 before the first. */
  roundIndex: number;
  scores: ScoreTable;
  rng: RngState;
  usedWords: string[];
  round?: PictionaryRound;
  roundsDrawn: Record<string, number>;
  roundsWon: Record<string, number>;
}

export type PictionaryView = { match?: MatchSnapshot; round?: RoundSnapshot };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO: ScoreEntry = { points: 0, agentPoints: 0, humanPoints: 0 };

function addScore(table: ScoreTable, agentId: string, delta: Partial<ScoreEntry>): ScoreTable {
  const cur = table[agentId] ?? ZERO;
  return {
    ...table,
    [agentId]: {
      points: cur.points + (delta.points ?? 0),
      agentPoints: cur.agentPoints + (delta.agentPoints ?? 0),
      humanPoints: cur.humanPoints + (delta.humanPoints ?? 0),
    },
  };
}

function errorTo(
  session: SessionInfo,
  replyTo: string,
  code: ErrorCode,
  message: string,
  entitlement?: Entitlement,
): Effect {
  const payload = entitlement ? { code, message, entitlement } : { code, message };
  return {
    kind: "send",
    to: { sessionId: session.sessionId },
    message: { type: "error", payload, replyTo },
  };
}

function send(to: SessionTarget, message: ServerMessageBody): Effect {
  return { kind: "send", to, message };
}

function broadcast(
  audience: "all" | "non_agents" | "agents" | "humans" | "spectators",
  message: ServerMessageBody,
): Effect {
  return { kind: "broadcast", audience, message };
}

function timerId(kind: string, roundIndex: number, seq: number): string {
  return `${kind}:${roundIndex}:${seq}`;
}

function wordOptions(entries: WordEntry[]): WordOption[] {
  return entries.map((w, index) => ({ index, word: w.word, difficulty: w.difficulty }));
}

function guessersOf(state: PictionaryState, round: PictionaryRound): string[] {
  return state.order.filter((id) => id !== round.drawerAgentId);
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const pictionary: GameModule<PictionaryState, GameEvent, PictionaryView> = {
  id: "pictionary",

  init(config, players, rng) {
    const map: Record<string, GamePlayer> = {};
    for (const p of players) map[p.agentId] = p;
    return {
      config,
      status: "waiting",
      matchId: null,
      players: map,
      order: players.map((p) => p.agentId),
      roundsTotal: config.roundsPerPlayer * players.length,
      roundIndex: -1,
      scores: Object.fromEntries(players.map((p) => [p.agentId, ZERO])),
      rng,
      usedWords: [],
      roundsDrawn: Object.fromEntries(players.map((p) => [p.agentId, 0])),
      roundsWon: Object.fromEntries(players.map((p) => [p.agentId, 0])),
    };
  },

  handle(state, event): StepResult<PictionaryState> {
    switch (event.kind) {
      case "match.start":
        return startMatch(state, event.matchId, event.now, event.seq);
      case "client":
        return handleClient(
          state,
          event.session,
          event.message,
          event.now,
          event.seq,
          event.recvNs,
        );
      case "tick":
        return handleTick(state, event.timerId, event.now, event.seq);
      case "player.connected":
        return playerConnected(state, event.agentId);
      case "player.disconnected":
        return playerDisconnected(state, event.agentId, event.now, event.seq);
      case "humans.changed": {
        const p = state.players[event.agentId];
        if (!p) return { state, effects: [] };
        const next = {
          ...state,
          players: { ...state.players, [event.agentId]: { ...p, humans: event.humans } },
        };
        return maybeExhausted(next, event.now, event.seq);
      }
      case "player.entitlements": {
        const p = state.players[event.agentId];
        if (!p) return { state, effects: [] };
        return {
          state: {
            ...state,
            players: {
              ...state.players,
              [event.agentId]: { ...p, entitlements: event.entitlements },
            },
          },
          effects: [],
        };
      }
    }
  },

  view(state, viewer): PictionaryView {
    if (state.matchId === null) return {};
    const match: MatchSnapshot = {
      matchId: state.matchId,
      roundIndex: Math.max(0, state.roundIndex),
      roundsTotal: state.roundsTotal,
      order: state.order,
      scores: state.scores,
    };
    const r = state.round;
    if (!r) return { match };
    const isDrawerAgent = viewer.role === "agent" && viewer.agentId === r.drawerAgentId;
    const isGuesserAgent = viewer.role === "agent" && !isDrawerAgent;
    const isHuman = viewer.role === "human";
    const reveal = r.phase === "reveal";
    const word = r.word;

    const round: RoundSnapshot = {
      phase: r.phase,
      roundIndex: r.index,
      drawerAgentId: r.drawerAgentId,
      deadline: r.deadline,
      wordPattern: word ? wordPattern(word) : "",
      ops: r.ops,
    };
    if (word && (isDrawerAgent || reveal)) round.word = word;
    if (isDrawerAgent) {
      if (r.phase === "choosing" && r.options) round.options = wordOptions(r.options);
      round.wrongGuesses = r.wrongGuesses;
    }
    if (isGuesserAgent && viewer.agentId) {
      round.myGuessesRemaining = r.agentGuessesLeft[viewer.agentId] ?? 0;
    }
    if (isHuman && viewer.agentId && viewer.agentId !== r.drawerAgentId) {
      round.myGuessesRemaining = r.humanGuessesLeft[viewer.agentId] ?? 0;
    }
    if (viewer.role !== "agent") {
      round.feed = r.guesses.map(feedItem);
    }
    return { match, round };
  },

  isFinished(state) {
    return state.status === "ended";
  },
};

function feedItem(g: GuessRecord): GuessFeedItem {
  return { seq: g.seq, agentId: g.agentId, source: g.source, text: g.text, result: g.result };
}

// ---------------------------------------------------------------------------
// Match lifecycle
// ---------------------------------------------------------------------------

function startMatch(
  state: PictionaryState,
  matchId: string,
  now: number,
  seq: number,
): StepResult<PictionaryState> {
  if (state.status !== "waiting") return { state, effects: [] };
  const next: PictionaryState = { ...state, status: "running", matchId };
  const effects: Effect[] = [
    {
      kind: "persist",
      record: {
        type: "match.started",
        matchId,
        startedAt: now,
        order: next.order,
        roundsTotal: next.roundsTotal,
      },
    },
    broadcast("all", {
      type: "match.started",
      payload: { matchId, order: next.order, roundsTotal: next.roundsTotal },
    }),
  ];
  const r = beginRound(next, 0, now, seq);
  return { state: r.state, effects: [...effects, ...r.effects] };
}

function beginRound(
  state: PictionaryState,
  index: number,
  now: number,
  seq: number,
): StepResult<PictionaryState> {
  if (index >= state.roundsTotal) return endMatch(state, now);
  const connected = state.order.filter((id) => state.players[id]?.connected);
  if (connected.length < 2) return endMatch(state, now);

  const drawerAgentId = state.order[index % state.order.length] as string;
  const [options, rng] = pickWordOptions(state.rng, new Set(state.usedWords));
  const deadline = now + state.config.chooseSeconds * 1000;
  const phaseTimer = timerId("choosing", index, seq);
  const agentGuessesLeft: Record<string, number> = {};
  const humanGuessesLeft: Record<string, number> = {};
  for (const id of state.order) {
    if (id === drawerAgentId) continue;
    agentGuessesLeft[id] = state.config.guessesPerAgent;
    humanGuessesLeft[id] = state.config.humanGuessesPerRound;
  }
  const round: PictionaryRound = {
    index,
    drawerAgentId,
    phase: "choosing",
    deadline,
    phaseTimer,
    startedAt: now,
    options,
    aliases: [],
    wordSource: "pool",
    ops: [],
    nextOpSeq: 1,
    guesses: [],
    agentGuessesLeft,
    humanGuessesLeft,
    solved: {},
    wrongGuesses: 0,
  };
  let next: PictionaryState = {
    ...state,
    rng,
    roundIndex: index,
    round,
    roundsDrawn: {
      ...state.roundsDrawn,
      [drawerAgentId]: (state.roundsDrawn[drawerAgentId] ?? 0) + 1,
    },
  };
  const effects: Effect[] = [
    broadcast("all", {
      type: "round.choosing",
      payload: { roundIndex: index, drawerAgentId, deadline },
    }),
    send(
      { agentId: drawerAgentId },
      { type: "round.wordOptions", payload: { options: wordOptions(options) } },
    ),
    { kind: "schedule", at: deadline, timerId: phaseTimer },
  ];

  // Drawer already gone: give them the grace period, then skip.
  if (!state.players[drawerAgentId]?.connected) {
    const g = scheduleGrace(next, now, seq);
    next = g.state;
    effects.push(...g.effects);
  }
  return { state: next, effects };
}

function scheduleGrace(
  state: PictionaryState,
  now: number,
  seq: number,
): StepResult<PictionaryState> {
  const r = state.round;
  if (!r || r.ended) return { state, effects: [] };
  const graceTimer = timerId("grace", r.index, seq);
  const at = now + state.config.drawerGraceMs;
  return {
    state: { ...state, round: { ...r, graceTimer } },
    effects: [{ kind: "schedule", at, timerId: graceTimer }],
  };
}

function startDrawing(
  state: PictionaryState,
  entry: { word: string; aliases: string[]; source: WordSource },
  now: number,
  seq: number,
): StepResult<PictionaryState> {
  const r = state.round as PictionaryRound;
  const deadline = now + state.config.drawSeconds * 1000;
  const phaseTimer = timerId("drawing", r.index, seq);
  const round: PictionaryRound = {
    ...r,
    phase: "drawing",
    deadline,
    phaseTimer,
    drawingStartedAt: now,
    word: entry.word,
    aliases: entry.aliases,
    wordSource: entry.source,
  };
  delete round.options;
  const pattern = wordPattern(entry.word);
  const next: PictionaryState = { ...state, round, usedWords: [...state.usedWords, entry.word] };
  return {
    state: next,
    effects: [
      broadcast("all", {
        type: "round.started",
        payload: {
          roundIndex: r.index,
          drawerAgentId: r.drawerAgentId,
          deadline,
          wordLength: pattern.replace(/ /g, "").length,
          wordPattern: pattern,
        },
      }),
      { kind: "schedule", at: deadline, timerId: phaseTimer },
    ],
  };
}

function endRound(
  state: PictionaryState,
  reason: RoundEndReason,
  now: number,
  seq: number,
  winner?: RoundEnd["winner"],
  secondsLeft = 0,
): StepResult<PictionaryState> {
  const r = state.round as PictionaryRound;
  let roundScores: ScoreTable = {};
  if (winner) {
    if (winner.source === "agent") {
      roundScores = addScore(roundScores, winner.agentId, {
        points: 10 + Math.ceil(secondsLeft / 10),
        agentPoints: 10 + Math.ceil(secondsLeft / 10),
      });
    } else {
      roundScores = addScore(roundScores, winner.agentId, { points: 5, humanPoints: 5 });
    }
    roundScores = addScore(roundScores, r.drawerAgentId, { points: 5, agentPoints: 5 });
  }
  // firstCorrectEnds=false: later solvers earned points as they solved; those
  // were applied to state.scores already and are not in roundScores.
  let scores = state.scores;
  for (const [id, s] of Object.entries(roundScores)) scores = addScore(scores, id, s);

  const deadline = now + state.config.revealSeconds * 1000;
  const phaseTimer = timerId("reveal", r.index, seq);
  const ended: RoundEnd = winner ? { reason, winner, endedAt: now } : { reason, endedAt: now };
  const round: PictionaryRound = { ...r, phase: "reveal", deadline, phaseTimer, ended };
  delete round.graceTimer;
  const word = r.word ?? "";
  const roundsWon = winner
    ? { ...state.roundsWon, [winner.agentId]: (state.roundsWon[winner.agentId] ?? 0) + 1 }
    : state.roundsWon;
  const next: PictionaryState = { ...state, round, scores, roundsWon };

  const payload: ServerMessageBody & { type: "round.ended" } = {
    type: "round.ended",
    payload: {
      roundIndex: r.index,
      word,
      reason,
      scores,
      roundScores,
      ...(winner
        ? { winner: { agentId: winner.agentId, source: winner.source, seq: winner.seq } }
        : {}),
    },
  };
  const persist: Effect = {
    kind: "persist",
    record: {
      type: "round.ended",
      matchId: state.matchId as string,
      roundIndex: r.index,
      drawerAgentId: r.drawerAgentId,
      word,
      wordSource: r.wordSource,
      startedAt: r.startedAt,
      endedAt: now,
      reason,
      ...(winner ? { winner } : {}),
      guesses: r.guesses,
      ops: r.ops,
      roundScores,
      scores,
    },
  };
  return {
    state: next,
    effects: [
      persist,
      broadcast("all", payload),
      { kind: "schedule", at: deadline, timerId: phaseTimer },
    ],
  };
}

function endMatch(state: PictionaryState, now: number): StepResult<PictionaryState> {
  if (state.status === "ended") return { state, effects: [] };
  let best: string | undefined;
  let bestPts = Number.NEGATIVE_INFINITY;
  for (const id of state.order) {
    const pts = state.scores[id]?.points ?? 0;
    if (pts > bestPts) {
      bestPts = pts;
      best = id;
    }
  }
  const winnerAgentId = bestPts > 0 ? best : undefined;
  const next: PictionaryState = { ...state, status: "ended" };
  delete next.round;
  const matchId = state.matchId as string;
  return {
    state: next,
    effects: [
      {
        kind: "persist",
        record: {
          type: "match.ended",
          matchId,
          endedAt: now,
          scores: state.scores,
          roundsDrawn: state.roundsDrawn,
          roundsWon: state.roundsWon,
          ...(winnerAgentId ? { winnerAgentId } : {}),
        },
      },
      broadcast("all", {
        type: "match.ended",
        payload: { matchId, scores: state.scores, ...(winnerAgentId ? { winnerAgentId } : {}) },
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Ticks
// ---------------------------------------------------------------------------

function handleTick(
  state: PictionaryState,
  id: string,
  now: number,
  seq: number,
): StepResult<PictionaryState> {
  const r = state.round;
  if (!r || state.status !== "running") return { state, effects: [] };
  if (id === r.graceTimer) {
    if (r.ended) return { state, effects: [] };
    if (state.players[r.drawerAgentId]?.connected) return { state, effects: [] };
    return endRound(state, "drawer_left", now, seq);
  }
  if (id !== r.phaseTimer) return { state, effects: [] }; // stale
  switch (r.phase) {
    case "choosing": {
      // Drawer did not pick in time: pick for them.
      const opts = r.options ?? [];
      const [i, rng] = rngInt(state.rng, Math.max(1, opts.length));
      const w = opts[i];
      if (!w) return endRound(state, "timeout", now, seq);
      return startDrawing(
        { ...state, rng },
        { word: w.word, aliases: w.aliases ?? [], source: "pool" },
        now,
        seq,
      );
    }
    case "drawing":
      return r.firstWinner
        ? endRound(state, "timeout", now, seq, r.firstWinner.winner, r.firstWinner.secondsLeft)
        : endRound(state, "timeout", now, seq);
    case "reveal":
      return beginRound(state, r.index + 1, now, seq);
  }
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

function playerConnected(state: PictionaryState, agentId: string): StepResult<PictionaryState> {
  const p = state.players[agentId];
  if (!p) return { state, effects: [] };
  let next: PictionaryState = {
    ...state,
    players: { ...state.players, [agentId]: { ...p, connected: true } },
  };
  const r = next.round;
  if (r && r.drawerAgentId === agentId && r.graceTimer) {
    const round = { ...r };
    delete round.graceTimer; // the pending tick becomes stale
    next = { ...next, round };
  }
  return { state: next, effects: [] };
}

function playerDisconnected(
  state: PictionaryState,
  agentId: string,
  now: number,
  seq: number,
): StepResult<PictionaryState> {
  const p = state.players[agentId];
  if (!p) return { state, effects: [] };
  const next: PictionaryState = {
    ...state,
    players: { ...state.players, [agentId]: { ...p, connected: false } },
  };
  const r = next.round;
  if (
    state.status === "running" &&
    r &&
    !r.ended &&
    r.drawerAgentId === agentId &&
    r.phase !== "reveal"
  ) {
    return scheduleGrace(next, now, seq);
  }
  return maybeExhausted(next, now, seq);
}

// ---------------------------------------------------------------------------
// Client messages
// ---------------------------------------------------------------------------

function handleClient(
  state: PictionaryState,
  session: SessionInfo,
  message: ClientMessage,
  now: number,
  seq: number,
  recvNs: string | undefined,
): StepResult<PictionaryState> {
  const r = state.round;
  const id = message.id;
  const fail = (code: ErrorCode, text: string, ent?: Entitlement): StepResult<PictionaryState> => ({
    state,
    effects: [errorTo(session, id, code, text, ent)],
  });
  if (state.status !== "running" || !r) return fail("WRONG_PHASE", "no round in progress");
  const isDrawer = session.role === "agent" && session.agentId === r.drawerAgentId;
  const drawer = state.players[r.drawerAgentId];

  switch (message.type) {
    case "word.choose": {
      if (!isDrawer) return fail("NOT_DRAWER", "only the drawer chooses the word");
      if (r.phase !== "choosing") return fail("WRONG_PHASE", `cannot choose during ${r.phase}`);
      const w = r.options?.[message.payload.index];
      if (!w) return fail("BAD_REQUEST", "no such option");
      const res = startDrawing(
        state,
        { word: w.word, aliases: w.aliases ?? [], source: "pool" },
        now,
        seq,
      );
      return {
        state: res.state,
        effects: [
          send({ sessionId: session.sessionId }, { type: "ack", payload: {}, replyTo: id }),
          ...res.effects,
        ],
      };
    }
    case "word.custom": {
      if (!isDrawer) return fail("NOT_DRAWER", "only the drawer chooses the word");
      if (!(drawer?.entitlements ?? []).includes("custom_word")) {
        return fail(
          "ENTITLEMENT_REQUIRED",
          "custom words need the custom_word entitlement",
          "custom_word",
        );
      }
      if (r.phase !== "choosing") return fail("WRONG_PHASE", `cannot choose during ${r.phase}`);
      const v = validateCustomWord(message.payload.word);
      if (!v.ok)
        return fail(
          "INVALID_WORD",
          v.reason === "blocked" ? "word is not allowed" : "1-3 words, letters and spaces only",
        );
      const res = startDrawing(state, { word: v.word, aliases: [], source: "custom" }, now, seq);
      return {
        state: res.state,
        effects: [
          send({ sessionId: session.sessionId }, { type: "ack", payload: {}, replyTo: id }),
          ...res.effects,
        ],
      };
    }
    case "human.note": {
      if (session.role !== "human" || session.agentId !== r.drawerAgentId) {
        return fail("NOT_DRAWER", "only the drawer's human may send a note");
      }
      if (!(drawer?.entitlements ?? []).includes("custom_word")) {
        return fail(
          "ENTITLEMENT_REQUIRED",
          "notes to the drawer need the custom_word entitlement",
          "custom_word",
        );
      }
      if (r.phase !== "choosing")
        return fail("WRONG_PHASE", "notes are allowed during choosing only");
      return {
        state,
        effects: [
          send({ sessionId: session.sessionId }, { type: "ack", payload: {}, replyTo: id }),
          // Relayed to the drawer agent and nobody else.
          send(
            { agentId: r.drawerAgentId },
            { type: "human.note", payload: { text: message.payload.text } },
          ),
        ],
      };
    }
    case "draw.ops": {
      if (!isDrawer) return fail("NOT_DRAWER", "only the drawer draws");
      if (r.phase !== "drawing") return fail("WRONG_PHASE", `cannot draw during ${r.phase}`);
      const entries: OpLogEntry[] = [];
      let opSeq = r.nextOpSeq;
      const effects: Effect[] = [];
      for (const op of message.payload.ops) {
        const entry: OpLogEntry = { opSeq, op };
        entries.push(entry);
        effects.push(broadcast("all", { type: "draw.op", payload: { opSeq, op } }));
        opSeq++;
      }
      const round: PictionaryRound = { ...r, ops: [...r.ops, ...entries], nextOpSeq: opSeq };
      return {
        state: { ...state, round },
        effects: [
          send(
            { sessionId: session.sessionId },
            { type: "ack", payload: { opSeqFrom: r.nextOpSeq, opSeqTo: opSeq - 1 }, replyTo: id },
          ),
          ...effects,
        ],
      };
    }
    case "draw.erase":
    case "draw.clear": {
      if (!isDrawer) return fail("NOT_DRAWER", "only the drawer erases");
      if (!(drawer?.entitlements ?? []).includes("erase")) {
        return fail("ENTITLEMENT_REQUIRED", "erasing needs the erase entitlement", "erase");
      }
      if (r.phase !== "drawing") return fail("WRONG_PHASE", `cannot erase during ${r.phase}`);
      if (message.type === "draw.erase") {
        const target = message.payload.opSeq;
        const idx = r.ops.findIndex((e) => e.opSeq === target);
        if (idx < 0) return fail("BAD_REQUEST", "no such opSeq");
        const ops = r.ops.slice();
        ops[idx] = { ...(ops[idx] as OpLogEntry), erased: true };
        return {
          state: { ...state, round: { ...r, ops } },
          effects: [
            send({ sessionId: session.sessionId }, { type: "ack", payload: {}, replyTo: id }),
            broadcast("all", { type: "draw.erased", payload: { opSeq: target } }),
          ],
        };
      }
      const ops = r.ops.map((e) => (e.erased ? e : { ...e, erased: true }));
      return {
        state: { ...state, round: { ...r, ops } },
        effects: [
          send({ sessionId: session.sessionId }, { type: "ack", payload: {}, replyTo: id }),
          broadcast("all", { type: "draw.cleared", payload: {} }),
        ],
      };
    }
    case "guess.submit":
      return handleGuess(
        state,
        session,
        "agent",
        message.payload.text,
        id,
        message.ts,
        now,
        seq,
        recvNs,
      );
    case "human.guess":
      return handleGuess(
        state,
        session,
        "human",
        message.payload.text,
        id,
        message.ts,
        now,
        seq,
        recvNs,
      );
    default:
      return fail("BAD_REQUEST", `unexpected message ${message.type}`);
  }
}

function handleGuess(
  state: PictionaryState,
  session: SessionInfo,
  source: "agent" | "human",
  text: string,
  replyTo: string,
  clientTs: number,
  now: number,
  seq: number,
  recvNs: string | undefined,
): StepResult<PictionaryState> {
  const r = state.round as PictionaryRound;
  const fail = (code: ErrorCode, msg: string): StepResult<PictionaryState> => ({
    state,
    effects: [errorTo(session, replyTo, code, msg)],
  });
  if (source === "agent" && session.role !== "agent")
    return fail("NOT_GUESSER", "guess.submit is for agents");
  if (source === "human" && session.role !== "human")
    return fail("NOT_GUESSER", "human.guess is for humans");
  const agentId = session.agentId;
  if (!agentId || !state.players[agentId])
    return fail("NOT_GUESSER", "not paired to a player in this room");
  if (agentId === r.drawerAgentId) return fail("NOT_GUESSER", "the drawer's team cannot guess");
  if (r.phase === "choosing") return fail("WRONG_PHASE", "the drawer is still choosing a word");

  const normalized = normalizeGuess(text);
  const base = { seq, agentId, source, text, normalized, clientTs, ...(recvNs ? { recvNs } : {}) };
  const human = session.humanId ? { humanId: session.humanId } : {};

  // Round already over (reveal): record, but nobody can win now.
  if (r.phase === "reveal" || r.ended) {
    const matches = r.word ? matchGuess(text, r.word, r.aliases) === "correct" : false;
    const result: GuessResult = matches ? "late" : "round_over";
    const rec: GuessRecord = { ...base, ...human, result };
    const round = { ...r, guesses: [...r.guesses, rec] };
    const remaining =
      source === "agent" ? (r.agentGuessesLeft[agentId] ?? 0) : (r.humanGuessesLeft[agentId] ?? 0);
    return {
      state: { ...state, round },
      effects: [
        send(
          { sessionId: session.sessionId },
          { type: "guess.result", payload: { result, remaining }, replyTo },
        ),
        broadcast("non_agents", { type: "guess.feed", payload: feedItem(rec) }),
        {
          kind: "persist",
          record: {
            type: "guess.append",
            matchId: state.matchId as string,
            roundIndex: r.index,
            guess: rec,
          },
        },
      ],
    };
  }

  if (r.solved[agentId]) return fail("NO_GUESSES_LEFT", "your team already found the word");
  const agentLeft = r.agentGuessesLeft[agentId] ?? 0;
  const humanLeft = r.humanGuessesLeft[agentId] ?? 0;
  if (source === "agent" && agentLeft <= 0)
    return fail("NO_GUESSES_LEFT", "no agent guesses left this round");
  if (source === "human") {
    if (agentLeft > 0) return fail("NOT_GUESSER", "your agent still has guesses left");
    if (humanLeft <= 0) return fail("NO_GUESSES_LEFT", "no human guesses left this round");
  }

  const outcome = matchGuess(text, r.word as string, r.aliases);
  const result: GuessResult = outcome;
  const rec: GuessRecord = { ...base, ...human, result };
  let round: PictionaryRound = { ...r, guesses: [...r.guesses, rec] };
  let remaining: number;
  if (source === "agent") {
    remaining = agentLeft - 1;
    round = { ...round, agentGuessesLeft: { ...round.agentGuessesLeft, [agentId]: remaining } };
  } else {
    remaining = humanLeft - 1;
    round = { ...round, humanGuessesLeft: { ...round.humanGuessesLeft, [agentId]: remaining } };
  }
  const effects: Effect[] = [
    send(
      { sessionId: session.sessionId },
      { type: "guess.result", payload: { result, remaining }, replyTo },
    ),
    broadcast("non_agents", { type: "guess.feed", payload: feedItem(rec) }),
  ];

  if (outcome !== "correct") {
    round = { ...round, wrongGuesses: round.wrongGuesses + 1 };
    effects.push(
      send(
        { agentId: r.drawerAgentId },
        { type: "guess.count", payload: { wrongGuesses: round.wrongGuesses } },
      ),
    );
    return maybeExhausted({ ...state, round }, now, seq, effects);
  }

  // Correct.
  round = { ...round, solved: { ...round.solved, [agentId]: true } };
  const secondsLeft = Math.max(0, (r.deadline - now) / 1000);
  const winner: NonNullable<RoundEnd["winner"]> = {
    agentId,
    source,
    seq,
    ...human,
    ...(recvNs ? { recvNs } : {}),
  };
  const firstSolver = Object.keys(r.solved).length === 0;
  if (firstSolver && state.config.firstCorrectEnds) {
    const res = endRound({ ...state, round }, "guessed", now, seq, winner, secondsLeft);
    return { state: res.state, effects: [...effects, ...res.effects] };
  }
  // firstCorrectEnds=false: everyone may keep guessing until exhausted/timeout.
  let next: PictionaryState;
  if (firstSolver) {
    // The first solver wins the round; their points are applied at endRound.
    next = { ...state, round: { ...round, firstWinner: { winner, secondsLeft } } };
  } else {
    const pts = source === "agent" ? { points: 5, agentPoints: 5 } : { points: 3, humanPoints: 3 };
    next = { ...state, round, scores: addScore(state.scores, agentId, pts) };
  }
  return maybeExhausted(next, now, seq, effects);
}

/**
 * End the round when no guess can arrive any more: every connected guesser
 * team has spent its agent guesses and (if a human is attached) its human
 * guesses, or has already solved the word.
 */
function maybeExhausted(
  state: PictionaryState,
  now: number,
  seq: number,
  effects: Effect[] = [],
): StepResult<PictionaryState> {
  const r = state.round;
  if (!r || r.ended || r.phase !== "drawing" || state.status !== "running")
    return { state, effects };
  const guessers = guessersOf(state, r).filter((id) => state.players[id]?.connected);
  if (guessers.length === 0) return { state, effects };
  const live = guessers.some((id) => {
    if (r.solved[id]) return false;
    if ((r.agentGuessesLeft[id] ?? 0) > 0) return true;
    return (r.humanGuessesLeft[id] ?? 0) > 0 && (state.players[id]?.humans ?? 0) > 0;
  });
  if (live) return { state, effects };
  const res = r.firstWinner
    ? endRound(state, "guessed", now, seq, r.firstWinner.winner, r.firstWinner.secondsLeft)
    : endRound(state, "exhausted", now, seq);
  return { state: res.state, effects: [...effects, ...res.effects] };
}

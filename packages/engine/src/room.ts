import type {
  ClientMessage,
  Entitlement,
  PictionaryConfig,
  PlayerInfo,
  RoomCode,
  RoomStateSnapshot,
  RoomStatus,
  ServerMessageBody,
  Viewer,
} from "@pictionary/protocol";
import { type PictionaryState, pictionary } from "./pictionary.js";
import { type RngState, rngSeed } from "./rng.js";
import type { Effect, GameEvent, GamePlayer, RoomEvent, SessionInfo, StepResult } from "./types.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RoomPlayer {
  agentId: string;
  name: string;
  ready: boolean;
  entitlements: Entitlement[];
  /** Agent session ids currently connected for this agent (normally 0 or 1). */
  sessionIds: string[];
}

export interface RoomSession extends SessionInfo {
  connected: boolean;
}

export interface RoomState {
  code: RoomCode;
  gameId: "pictionary";
  config: PictionaryConfig;
  status: RoomStatus;
  /** Who may send room.start. Either may be undefined for anonymous creators. */
  creatorAgentId?: string;
  creatorHumanId?: string;
  sessions: Record<string, RoomSession>;
  players: Record<string, RoomPlayer>;
  /** Join order; also the drawer rotation at match start. */
  playerOrder: string[];
  rng: RngState;
  /** Last seq this state includes. */
  seq: number;
  /** Set when a match is created (status playing/finished). */
  game?: PictionaryState;
  matchCount: number;
}

export interface RoomInit {
  code: RoomCode;
  config: PictionaryConfig;
  seed: number;
  creatorAgentId?: string;
  creatorHumanId?: string;
}

export function createRoom(init: RoomInit): RoomState {
  const s: RoomState = {
    code: init.code,
    gameId: "pictionary",
    config: init.config,
    status: "lobby",
    sessions: {},
    players: {},
    playerOrder: [],
    rng: rngSeed(init.seed),
    seq: 0,
    matchCount: 0,
  };
  if (init.creatorAgentId) s.creatorAgentId = init.creatorAgentId;
  if (init.creatorHumanId) s.creatorHumanId = init.creatorHumanId;
  return s;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humansOf(state: RoomState, agentId: string): number {
  let n = 0;
  for (const s of Object.values(state.sessions)) {
    if (s.connected && s.role === "human" && s.agentId === agentId) n++;
  }
  return n;
}

export function playerInfo(state: RoomState, p: RoomPlayer): PlayerInfo {
  return {
    agentId: p.agentId,
    name: p.name,
    ready: p.ready,
    connected: p.sessionIds.length > 0,
    humans: humansOf(state, p.agentId),
  };
}

function gamePlayer(state: RoomState, p: RoomPlayer): GamePlayer {
  return {
    agentId: p.agentId,
    name: p.name,
    entitlements: p.entitlements,
    connected: p.sessionIds.length > 0,
    humans: humansOf(state, p.agentId),
  };
}

function send(sessionId: string, message: ServerMessageBody): Effect {
  return { kind: "send", to: { sessionId }, message };
}

function error(
  sessionId: string,
  replyTo: string,
  code: Parameters<typeof mkErr>[0],
  message: string,
): Effect {
  return send(sessionId, { type: "error", payload: mkErr(code, message), replyTo });
}

function mkErr(code: import("@pictionary/protocol").ErrorCode, message: string) {
  return { code, message };
}

/** Forward an event to the game module and fold the result into the room. */
function game(state: RoomState, ev: GameEvent): StepResult<RoomState> {
  if (!state.game || state.status !== "playing") return { state, effects: [] };
  const res = pictionary.handle(state.game, ev);
  const next: RoomState = { ...state, game: res.state };
  if (pictionary.isFinished(res.state)) next.status = "finished";
  return { state: next, effects: res.effects };
}

function chain(
  a: StepResult<RoomState>,
  f: (s: RoomState) => StepResult<RoomState>,
): StepResult<RoomState> {
  const b = f(a.state);
  return { state: b.state, effects: [...a.effects, ...b.effects] };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export function handleRoomEvent(state: RoomState, event: RoomEvent): StepResult<RoomState> {
  const stamped: RoomState = { ...state, seq: event.seq };
  switch (event.kind) {
    case "session.join":
      return join(stamped, event.session, event.now, event.seq);
    case "session.leave":
      return leave(stamped, event.sessionId, event.now, event.seq);
    case "client":
      return client(stamped, event.sessionId, event.message, event.now, event.seq, event.recvNs);
    case "tick":
      return game(stamped, {
        kind: "tick",
        seq: event.seq,
        now: event.now,
        timerId: event.timerId,
      });
    case "agent.entitlements": {
      const p = stamped.players[event.agentId];
      if (!p) return { state: stamped, effects: [] };
      const next: RoomState = {
        ...stamped,
        players: {
          ...stamped.players,
          [event.agentId]: { ...p, entitlements: event.entitlements },
        },
      };
      return game(next, {
        kind: "player.entitlements",
        seq: event.seq,
        now: event.now,
        agentId: event.agentId,
        entitlements: event.entitlements,
      });
    }
  }
}

function join(
  state: RoomState,
  info: SessionInfo,
  now: number,
  seq: number,
): StepResult<RoomState> {
  const sessionId = info.sessionId;
  const effects: Effect[] = [];
  let next: RoomState = state;

  if (info.role === "agent") {
    const agentId = info.agentId;
    if (!agentId) {
      return {
        state,
        effects: [
          {
            kind: "close",
            sessionId,
            code: "UNAUTHORIZED",
            message: "agent session without agent id",
          },
        ],
      };
    }
    const existing = next.players[agentId];
    if (!existing) {
      if (next.status !== "lobby") {
        return {
          state,
          effects: [
            { kind: "close", sessionId, code: "WRONG_PHASE", message: "match already started" },
          ],
        };
      }
      if (next.playerOrder.length >= next.config.maxPlayers) {
        return {
          state,
          effects: [{ kind: "close", sessionId, code: "ROOM_FULL", message: "room is full" }],
        };
      }
    }
    // Supersede any previous socket of this agent.
    const stale = existing?.sessionIds ?? [];
    for (const old of stale) {
      effects.push({
        kind: "close",
        sessionId: old,
        code: "UNAUTHORIZED",
        message: "superseded by a new connection",
      });
    }
    const sessions = { ...next.sessions };
    for (const old of stale) delete sessions[old];
    sessions[sessionId] = { ...info, connected: true };
    const player: RoomPlayer = {
      agentId,
      name: info.agentName ?? existing?.name ?? agentId,
      ready: existing?.ready ?? false,
      entitlements: info.entitlements ?? existing?.entitlements ?? [],
      sessionIds: [sessionId],
    };
    next = {
      ...next,
      sessions,
      players: { ...next.players, [agentId]: player },
      playerOrder: existing ? next.playerOrder : [...next.playerOrder, agentId],
    };
    effects.push(send(sessionId, { type: "room.state", payload: viewRoom(next, viewerOf(info)) }));
    if (!existing) {
      effects.push({
        kind: "broadcast",
        audience: "all",
        message: {
          type: "room.playerJoined",
          payload: { agentId, name: player.name, humans: humansOf(next, agentId) },
        },
      });
    } else if (stale.length === 0) {
      // Reconnect after a disconnect.
      const g = game(next, { kind: "player.connected", seq, now, agentId });
      next = g.state;
      effects.push(...g.effects);
    }
    return { state: next, effects };
  }

  // Human or spectator.
  const sessions = { ...next.sessions, [sessionId]: { ...info, connected: true } };
  next = { ...next, sessions };
  effects.push(send(sessionId, { type: "room.state", payload: viewRoom(next, viewerOf(info)) }));
  if (info.role === "human" && info.agentId && next.players[info.agentId]) {
    const g = game(next, {
      kind: "humans.changed",
      seq,
      now,
      agentId: info.agentId,
      humans: humansOf(next, info.agentId),
    });
    next = g.state;
    effects.push(...g.effects);
  }
  return { state: next, effects };
}

function leave(
  state: RoomState,
  sessionId: string,
  now: number,
  seq: number,
): StepResult<RoomState> {
  const s = state.sessions[sessionId];
  if (!s) return { state, effects: [] };
  const sessions = { ...state.sessions };
  delete sessions[sessionId];
  let next: RoomState = { ...state, sessions };
  const effects: Effect[] = [];

  if (s.role === "agent" && s.agentId) {
    const p = next.players[s.agentId];
    if (p) {
      const remaining = p.sessionIds.filter((id) => id !== sessionId);
      if (remaining.length === p.sessionIds.length) return { state: next, effects }; // superseded socket
      if (next.status === "lobby") {
        // Leaving the lobby removes the player.
        const players = { ...next.players };
        delete players[s.agentId];
        next = { ...next, players, playerOrder: next.playerOrder.filter((id) => id !== s.agentId) };
        effects.push({
          kind: "broadcast",
          audience: "all",
          message: {
            type: "room.playerLeft",
            payload: { agentId: s.agentId, name: p.name, humans: 0 },
          },
        });
      } else {
        next = {
          ...next,
          players: { ...next.players, [s.agentId]: { ...p, sessionIds: remaining } },
        };
        const g = game(next, { kind: "player.disconnected", seq, now, agentId: s.agentId });
        next = g.state;
        effects.push(...g.effects);
      }
    }
  } else if (s.role === "human" && s.agentId && next.players[s.agentId]) {
    const g = game(next, {
      kind: "humans.changed",
      seq,
      now,
      agentId: s.agentId,
      humans: humansOf(next, s.agentId),
    });
    next = g.state;
    effects.push(...g.effects);
  }
  return { state: next, effects };
}

function client(
  state: RoomState,
  sessionId: string,
  message: ClientMessage,
  now: number,
  seq: number,
  recvNs: string | undefined,
): StepResult<RoomState> {
  const session = state.sessions[sessionId];
  if (!session) {
    return { state, effects: [error(sessionId, message.id, "NOT_IN_ROOM", "unknown session")] };
  }
  switch (message.type) {
    case "hello":
      return {
        state,
        effects: [send(sessionId, { type: "ack", payload: {}, replyTo: message.id })],
      };
    case "ping":
      return {
        state,
        effects: [send(sessionId, { type: "pong", payload: {}, replyTo: message.id })],
      };
    case "room.ready": {
      if (session.role !== "agent" || !session.agentId || !state.players[session.agentId]) {
        return {
          state,
          effects: [error(sessionId, message.id, "NOT_IN_ROOM", "only player agents mark ready")],
        };
      }
      if (state.status !== "lobby") {
        return {
          state,
          effects: [error(sessionId, message.id, "WRONG_PHASE", "match already started")],
        };
      }
      const p = state.players[session.agentId] as RoomPlayer;
      const next: RoomState = {
        ...state,
        players: { ...state.players, [p.agentId]: { ...p, ready: true } },
      };
      const res: StepResult<RoomState> = {
        state: next,
        effects: [send(sessionId, { type: "ack", payload: {}, replyTo: message.id })],
      };
      // Auto-start when every player is ready and there are enough players.
      const all = next.playerOrder.every(
        (id) => next.players[id]?.ready && (next.players[id]?.sessionIds.length ?? 0) > 0,
      );
      if (all && next.playerOrder.length >= next.config.minPlayers) {
        return chain(res, (s) => startMatch(s, now, seq));
      }
      return res;
    }
    case "room.start": {
      if (state.status !== "lobby") {
        return {
          state,
          effects: [error(sessionId, message.id, "WRONG_PHASE", "match already started")],
        };
      }
      const isCreator =
        (state.creatorAgentId !== undefined &&
          session.agentId === state.creatorAgentId &&
          session.role === "agent") ||
        (state.creatorHumanId !== undefined && session.humanId === state.creatorHumanId) ||
        (state.creatorAgentId === undefined &&
          state.creatorHumanId === undefined &&
          session.role !== "spectator");
      if (!isCreator) {
        return {
          state,
          effects: [
            error(sessionId, message.id, "UNAUTHORIZED", "only the room creator starts the match"),
          ],
        };
      }
      const connected = state.playerOrder.filter(
        (id) => (state.players[id]?.sessionIds.length ?? 0) > 0,
      );
      if (connected.length < state.config.minPlayers) {
        return {
          state,
          effects: [
            error(
              sessionId,
              message.id,
              "BAD_REQUEST",
              `need at least ${state.config.minPlayers} connected players`,
            ),
          ],
        };
      }
      return chain(
        { state, effects: [send(sessionId, { type: "ack", payload: {}, replyTo: message.id })] },
        (s) => startMatch(s, now, seq),
      );
    }
    default: {
      if (state.status !== "playing" || !state.game) {
        return {
          state,
          effects: [error(sessionId, message.id, "WRONG_PHASE", "no match in progress")],
        };
      }
      const ev: GameEvent = recvNs
        ? { kind: "client", seq, now, session, message, recvNs }
        : { kind: "client", seq, now, session, message };
      return game(state, ev);
    }
  }
}

function startMatch(state: RoomState, now: number, seq: number): StepResult<RoomState> {
  const order = state.playerOrder.filter((id) => (state.players[id]?.sessionIds.length ?? 0) > 0);
  const players = order.map((id) => gamePlayer(state, state.players[id] as RoomPlayer));
  const matchId = `${state.code}-${state.matchCount + 1}`;
  const initial = pictionary.init(state.config, players, state.rng);
  const next: RoomState = {
    ...state,
    status: "playing",
    game: initial,
    matchCount: state.matchCount + 1,
  };
  return game(next, { kind: "match.start", seq, now, matchId });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function viewerOf(info: SessionInfo): Viewer {
  const v: Viewer = { sessionId: info.sessionId, role: info.role };
  if (info.agentId) v.agentId = info.agentId;
  if (info.humanId) v.humanId = info.humanId;
  return v;
}

/** Redacted room snapshot for one viewer (PLAN.md §11). */
export function viewRoom(state: RoomState, viewer: Viewer): RoomStateSnapshot {
  const snap: RoomStateSnapshot = {
    code: state.code,
    gameId: state.gameId,
    status: state.status,
    players: state.playerOrder.map((id) => playerInfo(state, state.players[id] as RoomPlayer)),
    config: state.config,
    seq: state.seq,
    you: viewer,
  };
  if (state.game) {
    const v = pictionary.view(state.game, viewer);
    if (v.match) snap.match = v.match;
    if (v.round) snap.round = v.round;
  }
  return snap;
}

/** Public, unredacted-but-safe room summary for GET /rooms/:code. */
export function roomPublic(state: RoomState) {
  return {
    code: state.code,
    gameId: state.gameId,
    status: state.status,
    players: state.playerOrder.map((id) => playerInfo(state, state.players[id] as RoomPlayer)),
    config: state.config,
  };
}

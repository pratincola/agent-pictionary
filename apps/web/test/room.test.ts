import type { RoomStateSnapshot, ServerMessage } from "@pictionary/protocol";
import { describe, expect, it } from "vitest";
import {
  agentGuessesRemaining,
  humanGuessGate,
  initialRoomView,
  phaseOf,
  type RoomViewState,
  roomReducer,
  standings,
} from "../src/state/room.js";

const A = "agent-a";
const B = "agent-b";
const C = "agent-c";

const config: RoomStateSnapshot["config"] = {
  roundsPerPlayer: 1,
  chooseSeconds: 20,
  drawSeconds: 90,
  revealSeconds: 5,
  guessesPerAgent: 3,
  humanGuessesPerRound: 3,
  firstCorrectEnds: true,
  minPlayers: 2,
  maxPlayers: 8,
  drawerGraceMs: 10_000,
};

function snapshot(role: "human" | "spectator", agentId?: string): RoomStateSnapshot {
  return {
    code: "ABCD23",
    gameId: "pictionary",
    status: "lobby",
    players: [
      { agentId: A, name: "alpha", ready: true, connected: true, humans: 0 },
      { agentId: B, name: "beta", ready: false, connected: true, humans: 1 },
      { agentId: C, name: "gamma", ready: false, connected: false, humans: 0 },
    ],
    config,
    seq: 7,
    you: { sessionId: "s1", role, ...(agentId ? { agentId } : {}) },
  };
}

let seq = 100;
function msg<T extends ServerMessage["type"]>(
  type: T,
  payload: Extract<ServerMessage, { type: T }>["payload"],
  extra: Partial<{ replyTo: string; ts: number }> = {},
): ServerMessage {
  seq += 1;
  return { type, seq, ts: extra.ts ?? 1_700_000_000_000, payload, ...extra } as ServerMessage;
}

function apply(state: RoomViewState, m: ServerMessage, pendingText?: string): RoomViewState {
  return roomReducer(state, {
    type: "message",
    msg: m,
    localNow: 0,
    ...(pendingText !== undefined ? { pendingText } : {}),
  });
}

function feed(
  agentId: string,
  source: "agent" | "human",
  text: string,
  result: "incorrect" | "correct" | "close",
) {
  seq += 1;
  return msg("guess.feed", { seq, agentId, source, text, result });
}

describe("room view reducer", () => {
  it("loads the snapshot and tracks the lobby", () => {
    let s = apply(initialRoomView, msg("room.state", snapshot("spectator")));
    expect(phaseOf(s)).toBe("lobby");
    expect(s.snap?.players).toHaveLength(3);
    s = apply(s, msg("room.playerLeft", { agentId: C, name: "gamma", humans: 0 }));
    expect(s.snap?.players.map((p) => p.agentId)).toEqual([A, B]);
    s = apply(s, msg("room.playerJoined", { agentId: C, name: "gamma", humans: 0 }));
    expect(s.snap?.players).toHaveLength(3);
    expect(s.snap?.players[2]?.ready).toBe(false);
  });

  it("runs a round: choosing -> drawing -> reveal, resetting ops and feed", () => {
    let s = apply(initialRoomView, msg("room.state", snapshot("spectator")));
    s = apply(s, msg("match.started", { matchId: "m1", order: [A, B, C], roundsTotal: 3 }));
    expect(s.snap?.status).toBe("playing");
    expect(s.snap?.match?.scores[A]?.points).toBe(0);

    s = apply(s, msg("round.choosing", { roundIndex: 0, drawerAgentId: A, deadline: 5_000 }));
    expect(phaseOf(s)).toBe("choosing");
    expect(s.snap?.round?.wordPattern).toBe("");

    s = apply(
      s,
      msg("round.started", {
        roundIndex: 0,
        drawerAgentId: A,
        deadline: 95_000,
        wordLength: 3,
        wordPattern: "___",
      }),
    );
    expect(phaseOf(s)).toBe("drawing");
    s = apply(
      s,
      msg("draw.op", {
        opSeq: 1,
        op: { kind: "line", from: [0, 0], to: [10, 10], width: 2, color: "#000000" },
      }),
    );
    s = apply(s, feed(B, "agent", "dog", "incorrect"));
    expect(s.opLog.ops).toHaveLength(1);
    expect(s.feed).toHaveLength(1);
    // Duplicate feed seq is ignored.
    s = apply(s, s.feed[0] ? msg("guess.feed", s.feed[0]) : feed(B, "agent", "x", "incorrect"));
    expect(s.feed).toHaveLength(1);

    const ended = msg(
      "round.ended",
      {
        roundIndex: 0,
        word: "cat",
        reason: "guessed",
        winner: { agentId: B, source: "human", seq: 50 },
        scores: {
          [A]: { points: 5, agentPoints: 5, humanPoints: 0 },
          [B]: { points: 5, agentPoints: 0, humanPoints: 5 },
          [C]: { points: 0, agentPoints: 0, humanPoints: 0 },
        },
        roundScores: {
          [A]: { points: 5, agentPoints: 5, humanPoints: 0 },
          [B]: { points: 5, agentPoints: 0, humanPoints: 5 },
          [C]: { points: 0, agentPoints: 0, humanPoints: 0 },
        },
      },
      { ts: 1_000_000 },
    );
    s = apply(s, ended);
    expect(phaseOf(s)).toBe("reveal");
    expect(s.snap?.round?.word).toBe("cat");
    expect(s.snap?.round?.deadline).toBe(1_000_000 + 5_000);
    expect(s.lastDeltas?.[B]?.points).toBe(5);
    expect(standings(s).map((p) => p.agentId)).toEqual([A, B, C]);

    // Next round clears the op log and the feed.
    s = apply(s, msg("round.choosing", { roundIndex: 1, drawerAgentId: B, deadline: 9_000 }));
    expect(s.opLog.ops).toHaveLength(0);
    expect(s.feed).toHaveLength(0);
    expect(s.roundEnd).toBeNull();
    expect(s.snap?.match?.roundIndex).toBe(1);

    s = apply(
      s,
      msg("match.ended", {
        matchId: "m1",
        winnerAgentId: A,
        scores: {
          [A]: { points: 15, agentPoints: 15, humanPoints: 0 },
          [B]: { points: 5, agentPoints: 0, humanPoints: 5 },
          [C]: { points: 0, agentPoints: 0, humanPoints: 0 },
        },
      }),
    );
    expect(phaseOf(s)).toBe("finished");
    expect(standings(s)[0]?.agentId).toBe(A);
  });

  it("gates the human guess box on the agent's spent guesses", () => {
    let s = apply(initialRoomView, msg("room.state", snapshot("human", B)));
    expect(humanGuessGate(s).enabled).toBe(false);
    s = apply(s, msg("match.started", { matchId: "m1", order: [A, B, C], roundsTotal: 3 }));
    s = apply(s, msg("round.choosing", { roundIndex: 0, drawerAgentId: A, deadline: 5_000 }));
    expect(humanGuessGate(s).reason).toMatch(/choosing/);
    s = apply(
      s,
      msg("round.started", {
        roundIndex: 0,
        drawerAgentId: A,
        deadline: 95_000,
        wordLength: 3,
        wordPattern: "___",
      }),
    );
    expect(s.snap?.round?.myGuessesRemaining).toBe(3);
    expect(agentGuessesRemaining(s, B)).toBe(3);
    expect(humanGuessGate(s)).toEqual({ enabled: false, reason: "Your agent still has 3 guesses" });

    s = apply(s, feed(B, "agent", "dog", "incorrect"));
    s = apply(s, feed(C, "agent", "cow", "incorrect")); // other team: no effect on B
    s = apply(s, feed(B, "agent", "cot", "close"));
    expect(humanGuessGate(s)).toEqual({ enabled: false, reason: "Your agent still has 1 guess" });
    s = apply(s, feed(B, "agent", "bat", "incorrect"));
    expect(agentGuessesRemaining(s, B)).toBe(0);
    expect(humanGuessGate(s)).toEqual({ enabled: true, reason: "3 guesses left" });

    // The human's own result decrements their counter and records the text.
    s = apply(
      s,
      msg("guess.result", { result: "incorrect", remaining: 2 }, { replyTo: "x" }),
      "rat",
    );
    expect(s.myLastResult).toEqual({ result: "incorrect", remaining: 2, text: "rat" });
    expect(s.snap?.round?.myGuessesRemaining).toBe(2);
    expect(humanGuessGate(s)).toEqual({ enabled: true, reason: "2 guesses left" });

    s = apply(s, feed(B, "human", "cat", "correct"));
    expect(humanGuessGate(s)).toEqual({
      enabled: false,
      reason: "Your team already found the word",
    });
  });

  it("disables the box for the drawer's human and for spectators", () => {
    let s = apply(initialRoomView, msg("room.state", snapshot("human", A)));
    s = apply(s, msg("match.started", { matchId: "m1", order: [A, B, C], roundsTotal: 3 }));
    s = apply(s, msg("round.choosing", { roundIndex: 0, drawerAgentId: A, deadline: 5_000 }));
    s = apply(
      s,
      msg("round.started", {
        roundIndex: 0,
        drawerAgentId: A,
        deadline: 95_000,
        wordLength: 3,
        wordPattern: "___",
      }),
    );
    expect(s.snap?.round?.myGuessesRemaining).toBeUndefined();
    expect(humanGuessGate(s)).toEqual({ enabled: false, reason: "Your agent is drawing" });
    const spec = apply(initialRoomView, msg("room.state", snapshot("spectator")));
    expect(humanGuessGate(spec).enabled).toBe(false);
  });

  it("re-syncs from a reconnect snapshot mid-round", () => {
    let s = apply(initialRoomView, msg("room.state", snapshot("spectator")));
    s = apply(s, msg("match.started", { matchId: "m1", order: [A, B, C], roundsTotal: 3 }));
    s = apply(s, msg("round.choosing", { roundIndex: 0, drawerAgentId: A, deadline: 5_000 }));
    const gen = s.opLog.generation;
    const snap: RoomStateSnapshot = {
      ...snapshot("spectator"),
      status: "playing",
      seq: 400,
      match: { matchId: "m1", roundIndex: 0, roundsTotal: 3, order: [A, B, C], scores: {} },
      round: {
        phase: "drawing",
        roundIndex: 0,
        drawerAgentId: A,
        deadline: 95_000,
        wordPattern: "___",
        ops: [
          { opSeq: 1, op: { kind: "line", from: [0, 0], to: [1, 1], width: 1, color: "#000000" } },
          {
            opSeq: 2,
            op: { kind: "line", from: [0, 0], to: [2, 2], width: 1, color: "#000000" },
            erased: true,
          },
        ],
        feed: [{ seq: 300, agentId: B, source: "agent", text: "dog", result: "incorrect" }],
      },
    };
    s = apply(s, msg("room.state", snap));
    expect(phaseOf(s)).toBe("drawing");
    expect(s.seq).toBe(400);
    expect(s.opLog.ops).toHaveLength(2);
    expect(s.opLog.generation).toBe(gen + 1);
    expect(s.feed).toHaveLength(1);
  });

  it("keeps errors with replyTo for inline display and others for the toast", () => {
    let s = apply(initialRoomView, msg("room.state", snapshot("human", B)));
    s = apply(
      s,
      msg(
        "error",
        { code: "NOT_GUESSER", message: "your agent still has guesses left" },
        {
          replyTo: "req-1",
        },
      ),
    );
    expect(s.lastError?.replyTo).toBe("req-1");
    s = roomReducer(s, { type: "clear-error" });
    expect(s.lastError).toBeNull();
  });
});

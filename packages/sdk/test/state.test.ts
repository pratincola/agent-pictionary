import type { RoomStateSnapshot, ServerMessage } from "@pictionary/protocol";
import { describe, expect, it } from "vitest";
import { type AgentState, lastOpSeq, reduce, secondsLeft, visibleOpLog } from "../src/state.js";

const ME = "agent-me";
const OTHER = "agent-other";

const snapshot: RoomStateSnapshot = {
  code: "ABCDEF",
  gameId: "pictionary",
  status: "lobby",
  players: [
    { agentId: ME, name: "me", ready: false, connected: true, humans: 0 },
    { agentId: OTHER, name: "other", ready: true, connected: true, humans: 1 },
  ],
  config: {
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
  },
  seq: 4,
  you: { sessionId: "sess", role: "agent", agentId: ME },
};

let seq = 10;
const m = <T extends ServerMessage["type"]>(
  type: T,
  payload: Extract<ServerMessage, { type: T }>["payload"],
): ServerMessage => ({ type, seq: ++seq, ts: 1, payload }) as ServerMessage;

function play(msgs: ServerMessage[], start?: AgentState): AgentState {
  let s: AgentState | undefined = start ?? reduce(undefined, m("room.state", snapshot));
  for (const msg of msgs) s = reduce(s, msg);
  return s as AgentState;
}

const op = (n: number) =>
  m("draw.op", {
    opSeq: n,
    op: { kind: "line", from: [0, 0], to: [n, n], width: 2, color: "#000000" },
  });

describe("reduce", () => {
  it("ignores everything before the first room.state", () => {
    expect(reduce(undefined, m("match.started", { matchId: "x", order: [], roundsTotal: 1 }))).toBe(
      undefined,
    );
  });

  it("room.state replaces state and tracks seq", () => {
    const s = play([]);
    expect(s.code).toBe("ABCDEF");
    expect(s.seq).toBe(4);
    const s2 = play([m("room.playerJoined", { agentId: "x", name: "x", humans: 0 })], s);
    expect(s2.seq).toBe(seq);
    expect(s).not.toBe(s2); // pure
    expect(s.players).toHaveLength(2);
  });

  it("player join/leave", () => {
    const s = play([
      m("room.playerJoined", { agentId: "new", name: "new", humans: 2 }),
      m("room.playerLeft", { agentId: OTHER, name: "other", humans: 1 }),
    ]);
    expect(s.players.find((p) => p.agentId === "new")).toMatchObject({
      connected: true,
      humans: 2,
    });
    expect(s.players.find((p) => p.agentId === OTHER)).toMatchObject({
      connected: false,
      ready: true,
    });
  });

  it("follows a round as a guesser: choosing -> drawing -> ops -> result -> reveal", () => {
    const s = play([
      m("match.started", { matchId: "m1", order: [OTHER, ME], roundsTotal: 2 }),
      m("round.choosing", { roundIndex: 0, drawerAgentId: OTHER, deadline: 1000 }),
    ]);
    expect(s.status).toBe("playing");
    expect(s.round?.phase).toBe("choosing");
    expect(s.round?.ops).toEqual([]);

    const d = play(
      [
        m("round.started", {
          roundIndex: 0,
          drawerAgentId: OTHER,
          deadline: 5000,
          wordLength: 3,
          wordPattern: "___",
        }),
        op(1),
        op(2),
        op(2), // duplicate ignored
        op(3),
      ],
      s,
    );
    expect(d.round?.phase).toBe("drawing");
    expect(d.round?.wordPattern).toBe("___");
    expect(d.round?.myGuessesRemaining).toBe(3);
    expect(d.round?.ops.map((e) => e.opSeq)).toEqual([1, 2, 3]);
    expect(d.opsReceived).toBe(3);
    expect(lastOpSeq(d)).toBe(3);

    const e = play(
      [m("draw.erased", { opSeq: 2 }), m("guess.result", { result: "incorrect", remaining: 2 })],
      d,
    );
    expect(visibleOpLog(e).map((x) => x.opSeq)).toEqual([1, 3]);
    expect(e.round?.myGuessesRemaining).toBe(2);
    expect(lastOpSeq(e)).toBe(3);

    const c = play([m("draw.cleared", {})], e);
    expect(visibleOpLog(c)).toEqual([]);
    expect(c.round?.ops).toHaveLength(3);

    const r = play(
      [
        m("round.ended", {
          roundIndex: 0,
          word: "cat",
          reason: "guessed",
          winner: { agentId: ME, source: "agent", seq: 40 },
          scores: { [ME]: { points: 19, agentPoints: 19, humanPoints: 0 } },
          roundScores: { [ME]: { points: 19, agentPoints: 19, humanPoints: 0 } },
        }),
      ],
      c,
    );
    expect(r.round?.phase).toBe("reveal");
    expect(r.round?.word).toBe("cat");
    expect(r.match?.scores[ME]?.points).toBe(19);
    expect(r.lastRoundEnded?.winner?.agentId).toBe(ME);

    // Next round resets the op log but keeps lastRoundEnded.
    const n = play([m("round.choosing", { roundIndex: 1, drawerAgentId: ME, deadline: 9000 })], r);
    expect(n.round?.ops).toEqual([]);
    expect(n.round?.word).toBeUndefined();
    expect(n.lastRoundEnded?.word).toBe("cat");
    expect(n.match?.roundIndex).toBe(1);

    const f = play([m("match.ended", { matchId: "m1", scores: {}, winnerAgentId: ME })], n);
    expect(f.status).toBe("finished");
  });

  it("drawer sees options, notes and the wrong-guess counter", () => {
    const s = play([
      m("match.started", { matchId: "m1", order: [ME, OTHER], roundsTotal: 2 }),
      m("round.choosing", { roundIndex: 0, drawerAgentId: ME, deadline: 1000 }),
      m("round.wordOptions", {
        options: [
          { index: 0, word: "cat", difficulty: "easy" },
          { index: 1, word: "castle", difficulty: "medium" },
          { index: 2, word: "karma", difficulty: "hard" },
        ],
      }),
      m("human.note", { text: "draw whiskers" }),
    ]);
    expect(s.round?.options?.map((o) => o.word)).toEqual(["cat", "castle", "karma"]);
    expect(s.notes).toEqual(["draw whiskers"]);
    const d = play(
      [
        m("round.started", {
          roundIndex: 0,
          drawerAgentId: ME,
          deadline: 5000,
          wordLength: 3,
          wordPattern: "___",
        }),
        m("guess.count", { wrongGuesses: 2 }),
      ],
      s,
    );
    expect(d.round?.options).toBeUndefined();
    expect(d.round?.myGuessesRemaining).toBeUndefined();
    expect(d.round?.wrongGuesses).toBe(2);
  });

  it("secondsLeft rounds up and clamps at zero", () => {
    const s = play([
      m("match.started", { matchId: "m1", order: [ME, OTHER], roundsTotal: 2 }),
      m("round.choosing", { roundIndex: 0, drawerAgentId: ME, deadline: 10_500 }),
    ]);
    expect(secondsLeft(s, 0)).toBe(11);
    expect(secondsLeft(s, 10_400)).toBe(1);
    expect(secondsLeft(s, 20_000)).toBe(0);
    expect(secondsLeft(undefined)).toBe(0);
  });
});

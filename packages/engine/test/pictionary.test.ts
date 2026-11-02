import { describe, expect, it } from "vitest";
import { roomInDrawing, Sim } from "./sim.js";

describe("lobby and match start", () => {
  it("players join, get room.state, and auto-start when all are ready", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0", [], true);
    const a1 = sim.joinAgent("a1");
    expect(sim.state.status).toBe("lobby");
    expect(sim.last(a0, "room.state")?.payload.players).toHaveLength(1);
    expect(sim.last(a1, "room.state")?.payload.players).toHaveLength(2);
    expect(sim.messages(a0, "room.playerJoined")).toHaveLength(2);

    sim.send(a0, { type: "room.ready", payload: {} });
    expect(sim.state.status).toBe("lobby");
    sim.send(a1, { type: "room.ready", payload: {} });
    expect(sim.state.status).toBe("playing");
    const started = sim.last(a1, "match.started");
    expect(started?.payload.order).toEqual(["a0", "a1"]);
    expect(started?.payload.roundsTotal).toBe(2);
    expect(sim.round?.phase).toBe("choosing");
    expect(sim.round?.drawerAgentId).toBe("a0");
  });

  it("room.start by the creator forces a start; non-creators get UNAUTHORIZED", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0", [], true);
    sim.state = { ...sim.state, creatorAgentId: "a0" };
    const a1 = sim.joinAgent("a1");
    sim.send(a1, { type: "room.start", payload: {} });
    expect(sim.last(a1, "error")?.payload.code).toBe("UNAUTHORIZED");
    sim.send(a0, { type: "room.start", payload: {} });
    expect(sim.state.status).toBe("playing");
  });

  it("rejects a 9th agent with ROOM_FULL and late joiners once playing", () => {
    const sim = new Sim();
    for (let i = 0; i < 8; i++) sim.joinAgent(`a${i}`);
    const extra = sim.joinAgent("a8");
    expect(sim.closed.find((c) => c.sessionId === extra)?.code).toBe("ROOM_FULL");
    expect(sim.state.playerOrder).toHaveLength(8);
  });

  it("a player leaving the lobby is removed", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0");
    const a1 = sim.joinAgent("a1");
    sim.leave(a1);
    expect(sim.state.playerOrder).toEqual(["a0"]);
    expect(sim.last(a0, "room.playerLeft")?.payload.agentId).toBe("a1");
  });
});

describe("full happy path", () => {
  it("plays a two-round match to completion", () => {
    const sim = new Sim({ roundsPerPlayer: 1 });
    const a0 = sim.joinAgent("a0", [], true);
    const a1 = sim.joinAgent("a1");
    const h1 = sim.joinHuman("h1", "a1");
    const spec = sim.joinSpectator();
    sim.send(a0, { type: "room.ready", payload: {} });
    sim.send(a1, { type: "room.ready", payload: {} });

    // Round 0: a0 draws.
    expect(sim.round?.drawerAgentId).toBe("a0");
    const options = sim.last(a0, "round.wordOptions")?.payload.options;
    expect(options).toHaveLength(3);
    expect(options?.map((o) => o.difficulty)).toEqual(["easy", "medium", "hard"]);
    expect(sim.messages(a1, "round.wordOptions")).toHaveLength(0);
    expect(sim.timers.some((t) => t.timerId.startsWith("choosing:0"))).toBe(true);

    sim.send(a0, { type: "word.choose", payload: { index: 1 } });
    expect(sim.round?.phase).toBe("drawing");
    const word = sim.word;
    expect(word).toBe(options?.[1]?.word);
    const started = sim.last(a1, "round.started")?.payload;
    expect(started?.wordPattern.replace(/ /g, "").length).toBe(started?.wordLength);
    expect(started).not.toHaveProperty("word");

    // Drawer draws; everyone sees ops with contiguous opSeq.
    sim.send(a0, {
      type: "draw.ops",
      payload: {
        ops: [
          { kind: "line", from: [0, 0], to: [100, 100], width: 2, color: "#000000" },
          { kind: "rect", x: 10, y: 10, w: 50, h: 50, width: 4, color: "#ff0000" },
        ],
      },
    });
    expect(sim.last(a0, "ack")?.payload).toEqual({ opSeqFrom: 1, opSeqTo: 2 });
    for (const s of [a0, a1, h1, spec]) {
      expect(
        sim.messages(s, "draw.op").map((d) => (d.message.payload as { opSeq: number }).opSeq),
      ).toEqual([1, 2]);
    }

    // a1 misses once (feed to human + spectator only), then guesses right.
    sim.send(a1, { type: "guess.submit", payload: { text: "zzzz-not-it" } });
    expect(sim.last(a1, "guess.result")?.payload).toEqual({ result: "incorrect", remaining: 2 });
    expect(sim.last(a0, "guess.count")?.payload.wrongGuesses).toBe(1);
    expect(sim.messages(h1, "guess.feed")).toHaveLength(1);
    expect(sim.messages(spec, "guess.feed")).toHaveLength(1);
    expect(sim.messages(a0, "guess.feed")).toHaveLength(0);
    expect(sim.messages(a1, "guess.feed")).toHaveLength(0);

    sim.now += 30_000; // 60 s left -> bonus ceil(60/10) = 6
    sim.send(a1, { type: "guess.submit", payload: { text: `The ${word}!` } });
    expect(sim.last(a1, "guess.result")?.payload.result).toBe("correct");
    const ended = sim.last(spec, "round.ended")?.payload;
    expect(ended?.reason).toBe("guessed");
    expect(ended?.word).toBe(word);
    expect(ended?.winner?.agentId).toBe("a1");
    expect(ended?.roundScores).toEqual({
      a1: { points: 16, agentPoints: 16, humanPoints: 0 },
      a0: { points: 5, agentPoints: 5, humanPoints: 0 },
    });
    // Persist comes before the broadcast.
    const idxPersist = sim.effects.findIndex(
      (e) => e.kind === "persist" && e.record.type === "round.ended",
    );
    const idxBroadcast = sim.effects.findIndex(
      (e) => e.kind === "broadcast" && e.message.type === "round.ended",
    );
    expect(idxPersist).toBeGreaterThan(-1);
    expect(idxPersist).toBeLessThan(idxBroadcast);
    expect(sim.round?.phase).toBe("reveal");

    // Reveal timer -> round 1, a1 draws.
    expect(sim.fire("reveal:0")).toBe(true);
    expect(sim.round?.index).toBe(1);
    expect(sim.round?.drawerAgentId).toBe("a1");
    expect(sim.round?.phase).toBe("choosing");
    // Choosing timeout picks a word for the drawer.
    expect(sim.fire("choosing:1")).toBe(true);
    expect(sim.round?.phase).toBe("drawing");
    // Nobody guesses; drawing timer ends the round with no winner.
    expect(sim.fire("drawing:1")).toBe(true);
    const ended1 = sim.last(a0, "round.ended")?.payload;
    expect(ended1?.reason).toBe("timeout");
    expect(ended1?.winner).toBeUndefined();
    expect(ended1?.roundScores).toEqual({});
    expect(sim.fire("reveal:1")).toBe(true);

    expect(sim.state.status).toBe("finished");
    const matchEnded = sim.last(spec, "match.ended")?.payload;
    expect(matchEnded?.winnerAgentId).toBe("a1");
    expect(matchEnded?.scores.a1?.points).toBe(16);
    expect(sim.persisted.map((p) => p.type)).toEqual([
      "match.started",
      "round.ended",
      "round.ended",
      "match.ended",
    ]);
  });
});

describe("guess rules", () => {
  it("each agent has 3 guesses; the 4th is NO_GUESSES_LEFT", () => {
    const { sim, sessions, guessers } = roomInDrawing(3);
    const g = sessions[guessers[0] as string] as string;
    for (let i = 0; i < 3; i++) {
      sim.send(g, { type: "guess.submit", payload: { text: `wrong${i}` } });
      expect(sim.last(g, "guess.result")?.payload.remaining).toBe(2 - i);
    }
    sim.send(g, { type: "guess.submit", payload: { text: "wrong3" } });
    expect(sim.last(g, "error")?.payload.code).toBe("NO_GUESSES_LEFT");
    expect(sim.round?.guesses).toHaveLength(3);
  });

  it("close guesses are reported only to that guesser", () => {
    const { sim, sessions, guessers, drawer } = roomInDrawing(3);
    const g0 = sessions[guessers[0] as string] as string;
    const g1 = sessions[guessers[1] as string] as string;
    const word = sim.word;
    sim.send(g0, { type: "guess.submit", payload: { text: `${word}s` } });
    expect(sim.last(g0, "guess.result")?.payload.result).toBe("close");
    expect(sim.messages(g1).some((d) => JSON.stringify(d.message).includes(`${word}s`))).toBe(
      false,
    );
    expect(
      sim
        .messages(sessions[drawer] as string)
        .some((d) => JSON.stringify(d.message).includes(`${word}s`)),
    ).toBe(false);
    expect(sim.round?.phase).toBe("drawing");
  });

  it("drawer and the drawer's human cannot guess; guessing during choosing is WRONG_PHASE", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0", [], true);
    const a1 = sim.joinAgent("a1");
    const h0 = sim.joinHuman("h0", "a0");
    sim.send(a0, { type: "room.ready", payload: {} });
    sim.send(a1, { type: "room.ready", payload: {} });
    sim.send(a1, { type: "guess.submit", payload: { text: "x" } });
    expect(sim.last(a1, "error")?.payload.code).toBe("WRONG_PHASE");
    sim.send(a0, { type: "word.choose", payload: { index: 0 } });
    sim.send(a0, { type: "guess.submit", payload: { text: sim.word } });
    expect(sim.last(a0, "error")?.payload.code).toBe("NOT_GUESSER");
    sim.send(h0, { type: "human.guess", payload: { text: sim.word } });
    expect(sim.last(h0, "error")?.payload.code).toBe("NOT_GUESSER");
    expect(sim.round?.phase).toBe("drawing");
  });

  it("human may guess only after its agent spent all guesses; 3 human guesses", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0", [], true);
    const a1 = sim.joinAgent("a1");
    const h1 = sim.joinHuman("h1", "a1");
    const spec = sim.joinSpectator();
    sim.send(a0, { type: "room.ready", payload: {} });
    sim.send(a1, { type: "room.ready", payload: {} });
    sim.send(a0, { type: "word.choose", payload: { index: 0 } });

    sim.send(h1, { type: "human.guess", payload: { text: "early" } });
    expect(sim.last(h1, "error")?.payload.code).toBe("NOT_GUESSER");
    for (let i = 0; i < 3; i++)
      sim.send(a1, { type: "guess.submit", payload: { text: `miss${i}` } });
    sim.send(h1, { type: "human.guess", payload: { text: "human miss 1" } });
    expect(sim.last(h1, "guess.result")?.payload).toEqual({ result: "incorrect", remaining: 2 });
    expect(sim.last(spec, "guess.feed")?.payload.source).toBe("human");
    sim.send(h1, { type: "human.guess", payload: { text: "human miss 2" } });
    sim.send(h1, { type: "human.guess", payload: { text: sim.word } });
    expect(sim.last(h1, "guess.result")?.payload.result).toBe("correct");
    const ended = sim.last(spec, "round.ended")?.payload;
    expect(ended?.winner).toEqual({ agentId: "a1", source: "human", seq: expect.any(Number) });
    expect(ended?.roundScores.a1).toEqual({ points: 5, agentPoints: 0, humanPoints: 5 });
    expect(ended?.roundScores.a0).toEqual({ points: 5, agentPoints: 5, humanPoints: 0 });
  });

  it("round ends 'exhausted' when every connected guesser team is out of guesses", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0", [], true);
    const a1 = sim.joinAgent("a1");
    const a2 = sim.joinAgent("a2");
    const h2 = sim.joinHuman("h2", "a2");
    for (const s of [a0, a1, a2]) sim.send(s, { type: "room.ready", payload: {} });
    sim.send(a0, { type: "word.choose", payload: { index: 0 } });
    for (let i = 0; i < 3; i++) sim.send(a1, { type: "guess.submit", payload: { text: `m${i}` } });
    for (let i = 0; i < 3; i++) sim.send(a2, { type: "guess.submit", payload: { text: `n${i}` } });
    // a2 has a human attached with 3 guesses: not exhausted yet.
    expect(sim.round?.phase).toBe("drawing");
    for (let i = 0; i < 3; i++) sim.send(h2, { type: "human.guess", payload: { text: `h${i}` } });
    expect(sim.round?.phase).toBe("reveal");
    expect(sim.last(a0, "round.ended")?.payload.reason).toBe("exhausted");
  });

  it("late correct guesses after the round ended get 'late'; wrong ones 'round_over'", () => {
    const { sim, sessions, guessers } = roomInDrawing(4);
    const [g0, g1, g2] = guessers.map((g) => sessions[g] as string) as [string, string, string];
    const word = sim.word;
    sim.send(g0, { type: "guess.submit", payload: { text: word } });
    sim.send(g1, { type: "guess.submit", payload: { text: word } });
    sim.send(g2, { type: "guess.submit", payload: { text: "nope" } });
    expect(sim.last(g0, "guess.result")?.payload.result).toBe("correct");
    expect(sim.last(g1, "guess.result")?.payload.result).toBe("late");
    expect(sim.last(g2, "guess.result")?.payload.result).toBe("round_over");
    const persisted = sim.persisted.find((p) => p.type === "round.ended");
    expect(persisted?.type === "round.ended" && persisted.guesses.map((g) => g.result)).toEqual([
      "correct",
    ]);
    // Late guesses are kept in state for the audit log even though persistence already ran.
    expect(sim.round?.guesses.map((g) => g.result)).toEqual(["correct", "late", "round_over"]);
  });

  it("firstCorrectEnds=false lets later solvers score until exhausted", () => {
    const { sim, sessions, guessers } = roomInDrawing(3, { firstCorrectEnds: false });
    const [g0, g1] = guessers.map((g) => sessions[g] as string) as [string, string];
    const word = sim.word;
    sim.send(g0, { type: "guess.submit", payload: { text: word } });
    expect(sim.round?.phase).toBe("drawing");
    sim.send(g0, { type: "guess.submit", payload: { text: word } });
    expect(sim.last(g0, "error")?.payload.code).toBe("NO_GUESSES_LEFT");
    sim.send(g1, { type: "guess.submit", payload: { text: word } });
    expect(sim.last(g1, "guess.result")?.payload.result).toBe("correct");
    expect(sim.round?.phase).toBe("reveal");
    const ended = sim.last(g0, "round.ended")?.payload;
    expect(ended?.winner?.agentId).toBe(guessers[0]);
    expect(ended?.scores[guessers[1] as string]?.points).toBe(5);
  });
});

describe("drawing rules", () => {
  it("only the drawer draws, only in drawing phase", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0", [], true);
    const a1 = sim.joinAgent("a1");
    sim.send(a0, { type: "room.ready", payload: {} });
    sim.send(a1, { type: "room.ready", payload: {} });
    const op = {
      kind: "line" as const,
      from: [0, 0] as [number, number],
      to: [1, 1] as [number, number],
      width: 1 as const,
      color: "#000000",
    };
    sim.send(a0, { type: "draw.ops", payload: { ops: [op] } });
    expect(sim.last(a0, "error")?.payload.code).toBe("WRONG_PHASE");
    sim.send(a0, { type: "word.choose", payload: { index: 0 } });
    sim.send(a1, { type: "draw.ops", payload: { ops: [op] } });
    expect(sim.last(a1, "error")?.payload.code).toBe("NOT_DRAWER");
    sim.send(a0, { type: "draw.ops", payload: { ops: [op] } });
    expect(sim.round?.ops).toHaveLength(1);
  });

  it("erase and clear need the erase entitlement", () => {
    const { sim, sessions, drawer } = roomInDrawing(2);
    const d = sessions[drawer] as string;
    const op = {
      kind: "line" as const,
      from: [0, 0] as [number, number],
      to: [1, 1] as [number, number],
      width: 1 as const,
      color: "#000000",
    };
    sim.send(d, { type: "draw.ops", payload: { ops: [op, op] } });
    sim.send(d, { type: "draw.erase", payload: { opSeq: 1 } });
    expect(sim.last(d, "error")?.payload).toEqual({
      code: "ENTITLEMENT_REQUIRED",
      message: expect.any(String),
      entitlement: "erase",
    });
    sim.send(d, { type: "draw.clear", payload: {} });
    expect(sim.last(d, "error")?.payload.code).toBe("ENTITLEMENT_REQUIRED");
    expect(sim.round?.ops.every((e) => !e.erased)).toBe(true);

    // Grant mid-round via agent.entitlements.
    sim.apply({ kind: "agent.entitlements", agentId: drawer, entitlements: ["erase"] });
    sim.send(d, { type: "draw.erase", payload: { opSeq: 1 } });
    expect(sim.round?.ops[0]?.erased).toBe(true);
    expect(sim.round?.ops[1]?.erased).toBeUndefined();
    expect(sim.last(d, "draw.erased")?.payload.opSeq).toBe(1);
    sim.send(d, { type: "draw.clear", payload: {} });
    expect(sim.round?.ops.every((e) => e.erased)).toBe(true);
    expect(sim.last(d, "draw.cleared")).toBeDefined();
  });
});

describe("word choice", () => {
  it("custom word needs custom_word; validates format and blocklist", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0", [], true);
    const a1 = sim.joinAgent("a1");
    sim.send(a0, { type: "room.ready", payload: {} });
    sim.send(a1, { type: "room.ready", payload: {} });
    sim.send(a0, { type: "word.custom", payload: { word: "space whale" } });
    expect(sim.last(a0, "error")?.payload).toMatchObject({
      code: "ENTITLEMENT_REQUIRED",
      entitlement: "custom_word",
    });
    sim.apply({ kind: "agent.entitlements", agentId: "a0", entitlements: ["custom_word"] });
    sim.send(a0, { type: "word.custom", payload: { word: "sp4ce whale" } });
    expect(sim.last(a0, "error")?.payload.code).toBe("INVALID_WORD");
    sim.send(a0, { type: "word.custom", payload: { word: "one two three four" } });
    expect(sim.last(a0, "error")?.payload.code).toBe("INVALID_WORD");
    sim.send(a0, { type: "word.custom", payload: { word: "Shit" } });
    expect(sim.last(a0, "error")?.payload.code).toBe("INVALID_WORD");
    sim.send(a0, { type: "word.custom", payload: { word: "Space  Whale" } });
    expect(sim.round?.phase).toBe("drawing");
    expect(sim.word).toBe("space whale");
    expect(sim.round?.wordSource).toBe("custom");
    expect(sim.last(a1, "round.started")?.payload.wordPattern).toBe("_____ _____");
  });

  it("human.note goes to the drawer agent only, during choosing, when the drawer is paid", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0", ["custom_word"], true);
    const a1 = sim.joinAgent("a1");
    const h0 = sim.joinHuman("h0", "a0");
    const h1 = sim.joinHuman("h1", "a1");
    const spec = sim.joinSpectator();
    sim.send(a0, { type: "room.ready", payload: {} });
    sim.send(a1, { type: "room.ready", payload: {} });
    sim.send(h1, { type: "human.note", payload: { text: "psst" } });
    expect(sim.last(h1, "error")?.payload.code).toBe("NOT_DRAWER");
    sim.send(h0, { type: "human.note", payload: { text: "draw a whale" } });
    expect(sim.last(a0, "human.note")?.payload.text).toBe("draw a whale");
    for (const s of [a1, h1, spec, h0]) expect(sim.messages(s, "human.note")).toHaveLength(0);
    sim.send(a0, { type: "word.choose", payload: { index: 0 } });
    sim.send(h0, { type: "human.note", payload: { text: "too late" } });
    expect(sim.last(h0, "error")?.payload.code).toBe("WRONG_PHASE");
  });

  it("human.note from a free drawer's human is ENTITLEMENT_REQUIRED", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0", [], true);
    const a1 = sim.joinAgent("a1");
    const h0 = sim.joinHuman("h0", "a0");
    sim.send(a0, { type: "room.ready", payload: {} });
    sim.send(a1, { type: "room.ready", payload: {} });
    sim.send(h0, { type: "human.note", payload: { text: "hint" } });
    expect(sim.last(h0, "error")?.payload).toMatchObject({
      code: "ENTITLEMENT_REQUIRED",
      entitlement: "custom_word",
    });
    expect(sim.messages(a0, "human.note")).toHaveLength(0);
  });

  it("does not offer a word twice in one match", () => {
    const sim = new Sim({ roundsPerPlayer: 3, revealSeconds: 0 });
    const a0 = sim.joinAgent("a0", [], true);
    const a1 = sim.joinAgent("a1");
    sim.send(a0, { type: "room.ready", payload: {} });
    sim.send(a1, { type: "room.ready", payload: {} });
    const words: string[] = [];
    for (let i = 0; i < 6; i++) {
      sim.fire(`choosing:${i}`);
      words.push(sim.word);
      sim.fire(`drawing:${i}`);
      sim.fire(`reveal:${i}`);
    }
    expect(new Set(words).size).toBe(6);
    expect(sim.state.status).toBe("finished");
  });
});

describe("disconnects", () => {
  it("drawer gone longer than the grace period skips the round with no points", () => {
    const { sim, sessions, drawer, guessers } = roomInDrawing(3, { drawerGraceMs: 10_000 });
    sim.leave(sessions[drawer] as string);
    const grace = sim.timers.find((t) => t.timerId.startsWith("grace:0"));
    expect(grace?.at).toBe(sim.now + 10_000);
    sim.fire("grace:0");
    const ended = sim.last(sessions[guessers[0] as string] as string, "round.ended")?.payload;
    expect(ended?.reason).toBe("drawer_left");
    expect(ended?.roundScores).toEqual({});
    expect(sim.round?.phase).toBe("reveal");
  });

  it("drawer reconnecting within the grace period keeps the round alive", () => {
    const { sim, sessions, drawer } = roomInDrawing(3);
    sim.leave(sessions[drawer] as string);
    const d2 = sim.joinAgent(drawer);
    expect(sim.round?.graceTimer).toBeUndefined();
    sim.fire("grace:0"); // stale
    expect(sim.round?.phase).toBe("drawing");
    // Reconnected drawer still sees the word in its snapshot.
    expect(sim.last(d2, "room.state")?.payload.round?.word).toBe(sim.word);
  });

  it("a guesser reconnecting keeps its remaining guesses", () => {
    const { sim, sessions, guessers } = roomInDrawing(3);
    const g = guessers[0] as string;
    sim.send(sessions[g] as string, { type: "guess.submit", payload: { text: "miss" } });
    sim.leave(sessions[g] as string);
    const s2 = sim.joinAgent(g);
    expect(sim.last(s2, "room.state")?.payload.round?.myGuessesRemaining).toBe(2);
    sim.send(s2, { type: "guess.submit", payload: { text: "miss2" } });
    expect(sim.last(s2, "guess.result")?.payload.remaining).toBe(1);
  });

  it("a second socket for the same agent supersedes the first", () => {
    const { sim, sessions, guessers } = roomInDrawing(3);
    const g = guessers[0] as string;
    const old = sessions[g] as string;
    const fresh = sim.joinAgent(g);
    expect(sim.closed.find((c) => c.sessionId === old)).toBeDefined();
    expect(sim.state.players[g]?.sessionIds).toEqual([fresh]);
    expect(sim.state.sessions[old]).toBeUndefined();
  });
});

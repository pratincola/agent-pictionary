import { RoomStateSnapshot, type ServerMessageBody } from "@pictionary/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRoom, handleRoomEvent, type RoomEvent, viewRoom } from "../src/index.js";
import { roomInDrawing, Sim } from "./sim.js";

describe("fair ordering", () => {
  it("for any arrival order of N correct guesses, the winner is the lowest seq", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        (n, seed, interleave) => {
          const { sim, sessions, guessers } = roomInDrawing(n, {}, seed);
          const word = sim.word;
          // Random permutation of guessers, each sending the correct word, plus
          // some wrong guesses interleaved from random guessers.
          const order = fc.sample(fc.shuffledSubarray(guessers, { minLength: guessers.length }), {
            seed,
            numRuns: 1,
          })[0] as string[];
          const firstSeqByAgent = new Map<string, number>();
          let expectedWinner: string | undefined;
          let minSeq = Number.POSITIVE_INFINITY;
          order.forEach((g, i) => {
            if (interleave[i]) {
              const other = guessers[(guessers.indexOf(g) + 1) % guessers.length] as string;
              sim.send(sessions[other] as string, {
                type: "guess.submit",
                payload: { text: "definitely wrong" },
              });
            }
            sim.send(sessions[g] as string, { type: "guess.submit", payload: { text: word } });
            const seq = sim.seq;
            firstSeqByAgent.set(g, seq);
            if (seq < minSeq) {
              minSeq = seq;
              expectedWinner = g;
            }
          });
          const ended = sim.last(sessions[guessers[0] as string] as string, "round.ended");
          expect(ended).toBeDefined();
          expect(ended?.payload.winner?.agentId).toBe(expectedWinner);
          expect(ended?.payload.winner?.seq).toBe(minSeq);
          // Every correct guess other than the winner is 'late'.
          const correctGuesses = (sim.round?.guesses ?? []).filter(
            (g) => g.normalized === word.toLowerCase(),
          );
          expect(correctGuesses.filter((g) => g.result === "correct")).toHaveLength(1);
          expect(correctGuesses.filter((g) => g.result === "late")).toHaveLength(
            correctGuesses.length - 1,
          );
          expect(Math.min(...correctGuesses.map((g) => g.seq))).toBe(ended?.payload.winner?.seq);
          // Exactly one round.ended per session, identical for all.
          const payloads = Object.values(sessions).map((s) =>
            JSON.stringify(sim.last(s, "round.ended")?.payload),
          );
          expect(new Set(payloads).size).toBe(1);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("replay determinism", () => {
  it("replaying the event log yields a deep-equal state", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        (n, seed) => {
          const { sim, sessions, guessers, drawer } = roomInDrawing(n, { revealSeconds: 1 }, seed);
          const op = {
            kind: "path" as const,
            points: [
              [1, 2],
              [3, 4],
            ] as [number, number][],
            width: 2 as const,
            color: "#123456",
          };
          sim.send(sessions[drawer] as string, {
            type: "draw.ops",
            payload: { ops: [op, op, op] },
          });
          for (const g of guessers) {
            sim.send(sessions[g] as string, { type: "guess.submit", payload: { text: "nope" } });
          }
          sim.send(sessions[guessers[guessers.length - 1] as string] as string, {
            type: "guess.submit",
            payload: { text: sim.word },
          });
          sim.fire("reveal:0");
          // Replay from scratch.
          let state = createRoom({ code: "TEST42", config: sim.state.config, seed });
          for (const ev of sim.log) state = handleRoomEvent(state, ev as RoomEvent).state;
          expect(state).toEqual(sim.state);
          // And the effects of a second replay are identical too.
          let s2 = createRoom({ code: "TEST42", config: sim.state.config, seed });
          const effects: unknown[] = [];
          for (const ev of sim.log) {
            const r = handleRoomEvent(s2, ev as RoomEvent);
            s2 = r.state;
            effects.push(...r.effects);
          }
          expect(effects).toEqual(sim.effects);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("the engine never mutates the input state", () => {
    const { sim, sessions, guessers } = roomInDrawing(3);
    const before = structuredClone(sim.state);
    const frozen = sim.state;
    handleRoomEvent(frozen, {
      kind: "client",
      seq: 999,
      now: sim.now,
      sessionId: sessions[guessers[0] as string] as string,
      message: { type: "guess.submit", id: "x", ts: 1, payload: { text: sim.word } },
    });
    expect(frozen).toEqual(before);
  });
});

describe("redaction (PLAN.md §11)", () => {
  function allText(messages: { message: ServerMessageBody }[]): string {
    return messages.map((d) => JSON.stringify(d.message)).join("\n");
  }

  it("an agent never receives another agent's guess text; drawer sees the word, guessers do not", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 6 }),
        fc.array(
          fc.string({
            minLength: 3,
            maxLength: 12,
            unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzQ"),
          }),
          { minLength: 2, maxLength: 10 },
        ),
        (n, texts) => {
          const { sim, sessions, guessers, drawer } = roomInDrawing(n);
          const h = sim.joinHuman("hx", guessers[0] as string);
          const spec = sim.joinSpectator();
          const word = sim.word;
          const secrets = texts.map((t, i) => `${t}zq${i}`); // unique, never equal to the word
          secrets.forEach((t, i) => {
            const g = guessers[i % guessers.length] as string;
            sim.send(sessions[g] as string, { type: "guess.submit", payload: { text: t } });
          });
          // Agents: no foreign guess text, no guess.feed, no word before reveal.
          for (const a of guessers) {
            const box = sim.messages(sessions[a] as string);
            const text = allText(box);
            expect(box.some((d) => d.message.type === "guess.feed")).toBe(false);
            for (const s of secrets) expect(text.includes(s)).toBe(false);
            expect(text.includes(`"word":"${word}"`)).toBe(false);
            const snap = viewRoom(sim.state, {
              sessionId: sessions[a] as string,
              role: "agent",
              agentId: a,
            });
            RoomStateSnapshot.parse(snap);
            expect(snap.round?.word).toBeUndefined();
            expect(snap.round?.feed).toBeUndefined();
            expect(snap.round?.myGuessesRemaining).toBeDefined();
          }
          const dText = allText(sim.messages(sessions[drawer] as string));
          for (const s of secrets) expect(dText.includes(s)).toBe(false);
          const dSnap = viewRoom(sim.state, {
            sessionId: sessions[drawer] as string,
            role: "agent",
            agentId: drawer,
          });
          expect(dSnap.round?.word).toBe(word);
          expect(dSnap.round?.feed).toBeUndefined();
          expect(dSnap.round?.wrongGuesses).toBe(
            Math.min(secrets.length, sim.round?.guesses.length ?? 0),
          );
          // Humans and spectators see the feed but not the word.
          for (const s of [h, spec]) {
            const feed = sim.messages(s, "guess.feed");
            expect(feed.length).toBe(sim.round?.guesses.length);
            const snap = viewRoom(sim.state, {
              sessionId: s,
              role: s === h ? "human" : "spectator",
            });
            expect(snap.round?.word).toBeUndefined();
            expect(snap.round?.feed?.length).toBe(sim.round?.guesses.length);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("after the round ends, everyone sees the word", () => {
    const { sim, sessions, guessers, drawer } = roomInDrawing(3);
    const spec = sim.joinSpectator();
    sim.send(sessions[guessers[0] as string] as string, {
      type: "guess.submit",
      payload: { text: sim.word },
    });
    for (const [s, role, agentId] of [
      [sessions[guessers[1] as string] as string, "agent", guessers[1] as string],
      [sessions[drawer] as string, "agent", drawer],
      [spec, "spectator", undefined],
    ] as const) {
      const viewer = agentId ? { sessionId: s, role, agentId } : { sessionId: s, role };
      expect(viewRoom(sim.state, viewer).round?.word).toBe(sim.word);
      expect(sim.last(s, "round.ended")?.payload.word).toBe(sim.word);
    }
  });

  it("room.wordOptions goes to the drawer only and human.note never reaches guessers", () => {
    const sim = new Sim();
    const a0 = sim.joinAgent("a0", ["custom_word"], true);
    const a1 = sim.joinAgent("a1");
    const a2 = sim.joinAgent("a2");
    const h0 = sim.joinHuman("h0", "a0");
    for (const s of [a0, a1, a2]) sim.send(s, { type: "room.ready", payload: {} });
    sim.send(h0, { type: "human.note", payload: { text: "SECRET-HINT" } });
    expect(sim.messages(a0, "round.wordOptions")).toHaveLength(1);
    for (const s of [a1, a2]) {
      expect(sim.messages(s, "round.wordOptions")).toHaveLength(0);
      expect(allText(sim.messages(s)).includes("SECRET-HINT")).toBe(false);
    }
  });
});

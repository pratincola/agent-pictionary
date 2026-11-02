import { describe, expect, it } from "vitest";
import {
  ClientMessage,
  CreateRoomBody,
  DrawOp,
  PictionaryConfig,
  RoomStateSnapshot,
  ServerMessage,
} from "../src/index.js";

const stroke = { width: 2 as const, color: "#000000" };

describe("DrawOp", () => {
  it("accepts ops inside the 1000x1000 canvas", () => {
    expect(
      DrawOp.safeParse({
        kind: "path",
        points: [
          [0, 0],
          [1000, 1000],
        ],
        ...stroke,
      }).success,
    ).toBe(true);
    expect(DrawOp.safeParse({ kind: "line", from: [0, 0], to: [10, 10], ...stroke }).success).toBe(
      true,
    );
    expect(
      DrawOp.safeParse({ kind: "rect", x: 10, y: 10, w: 100, h: 50, ...stroke, fill: "#ff0000" })
        .success,
    ).toBe(true);
    expect(
      DrawOp.safeParse({ kind: "ellipse", cx: 500, cy: 500, rx: 100, ry: 50, ...stroke }).success,
    ).toBe(true);
  });
  it("rejects out-of-bounds, non-integer and oversized ops", () => {
    expect(DrawOp.safeParse({ kind: "path", points: [[-1, 0]], ...stroke }).success).toBe(false);
    expect(DrawOp.safeParse({ kind: "path", points: [[0, 1001]], ...stroke }).success).toBe(false);
    expect(DrawOp.safeParse({ kind: "path", points: [[0.5, 0]], ...stroke }).success).toBe(false);
    expect(DrawOp.safeParse({ kind: "path", points: [], ...stroke }).success).toBe(false);
    const tooMany = Array.from({ length: 501 }, (_, i) => [i, i] as [number, number]);
    expect(DrawOp.safeParse({ kind: "path", points: tooMany, ...stroke }).success).toBe(false);
    expect(DrawOp.safeParse({ kind: "rect", x: 950, y: 0, w: 100, h: 10, ...stroke }).success).toBe(
      false,
    );
    expect(
      DrawOp.safeParse({ kind: "ellipse", cx: 10, cy: 500, rx: 100, ry: 50, ...stroke }).success,
    ).toBe(false);
    expect(
      DrawOp.safeParse({ kind: "line", from: [0, 0], to: [10, 10], width: 3, color: "#000000" })
        .success,
    ).toBe(false);
    expect(
      DrawOp.safeParse({ kind: "line", from: [0, 0], to: [10, 10], width: 2, color: "red" })
        .success,
    ).toBe(false);
  });
  it("has no text op", () => {
    expect(DrawOp.safeParse({ kind: "text", x: 0, y: 0, text: "CAT", ...stroke }).success).toBe(
      false,
    );
  });
});

describe("ClientMessage", () => {
  it("parses a guess", () => {
    const m = ClientMessage.parse({
      type: "guess.submit",
      id: "abc",
      ts: 1,
      payload: { text: "cat" },
    });
    expect(m.type).toBe("guess.submit");
  });
  it("defaults empty payloads", () => {
    const m = ClientMessage.parse({ type: "ping", id: "abc", ts: 1 });
    expect(m.payload).toEqual({});
  });
  it("rejects unknown types, bad versions and >20 ops", () => {
    expect(ClientMessage.safeParse({ type: "chat.say", id: "a", ts: 1, payload: {} }).success).toBe(
      false,
    );
    expect(
      ClientMessage.safeParse({ type: "hello", id: "a", ts: 1, v: 2, payload: {} }).success,
    ).toBe(false);
    expect(ClientMessage.safeParse({ type: "hello", id: "a", ts: 1, v: 1 }).success).toBe(true);
    const ops = Array.from({ length: 21 }, () => ({
      kind: "line",
      from: [0, 0],
      to: [1, 1],
      ...stroke,
    }));
    expect(
      ClientMessage.safeParse({ type: "draw.ops", id: "a", ts: 1, payload: { ops } }).success,
    ).toBe(false);
  });
});

describe("ServerMessage", () => {
  it("parses round.ended", () => {
    const m = ServerMessage.parse({
      type: "round.ended",
      seq: 5,
      ts: 1,
      payload: {
        roundIndex: 0,
        word: "cat",
        reason: "guessed",
        winner: { agentId: "a1", source: "agent", seq: 4 },
        scores: { a1: { points: 10, agentPoints: 10, humanPoints: 0 } },
        roundScores: { a1: { points: 10, agentPoints: 10, humanPoints: 0 } },
      },
    });
    expect(m.type).toBe("round.ended");
  });
  it("parses a minimal room.state", () => {
    const snap = RoomStateSnapshot.parse({
      code: "ABCD23",
      gameId: "pictionary",
      status: "lobby",
      players: [],
      config: PictionaryConfig.parse({}),
      seq: 0,
      you: { sessionId: "s1", role: "spectator" },
    });
    expect(snap.config.drawSeconds).toBe(90);
  });
});

describe("REST bodies", () => {
  it("CreateRoomBody fills defaults and accepts partial config", () => {
    const b = CreateRoomBody.parse({ config: { drawSeconds: 5 } });
    expect(b.gameId).toBe("pictionary");
    expect(b.config?.drawSeconds).toBe(5);
    expect(PictionaryConfig.parse(b.config ?? {}).roundsPerPlayer).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { rewriteWsOrigin } from "../src/client.js";

describe("rewriteWsOrigin", () => {
  const wsUrl = "ws://localhost:8080/ws?token=a.b";

  it("returns wsUrl unchanged when wsBase is unset", () => {
    expect(rewriteWsOrigin(wsUrl, undefined)).toBe(wsUrl);
    expect(rewriteWsOrigin(wsUrl, "")).toBe(wsUrl);
  });

  it("swaps scheme and host, keeps path and query", () => {
    expect(rewriteWsOrigin(wsUrl, "ws://server:8080")).toBe("ws://server:8080/ws?token=a.b");
    expect(rewriteWsOrigin(wsUrl, "wss://arena.example.com")).toBe(
      "wss://arena.example.com/ws?token=a.b",
    );
  });

  it("ignores any path on wsBase", () => {
    expect(rewriteWsOrigin(wsUrl, "ws://server:8080/ignored/")).toBe(
      "ws://server:8080/ws?token=a.b",
    );
  });
});

/**
 * MCP server against the real arena server, driven through the official MCP
 * client over an in-memory transport. Two MCP sessions (two agents) play a
 * full two-round match.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DrawOp } from "@pictionary/protocol";
import type { ArenaServer } from "@pictionary/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpServer, TOOL_NAMES } from "../src/index.js";
import { startTestServer } from "./server.js";

let server: ArenaServer;
let base: string;
let tmp: string;

beforeAll(async () => {
  server = await startTestServer();
  base = server.baseUrl;
  tmp = mkdtempSync(join(tmpdir(), "ap-mcp-"));
});
afterAll(async () => {
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
});

type Args = Record<string, unknown>;

interface McpSession {
  client: Client;
  configPath: string;
  call(tool: string, args?: Args): Promise<CallToolResult>;
  text(tool: string, args?: Args): Promise<string>;
  close(): Promise<void>;
}

function textOf(r: CallToolResult): string {
  return r.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function mcpSession(name: string): Promise<McpSession> {
  const configPath = join(tmp, `${name}.json`);
  const { server: mcp, session } = createMcpServer({
    config: { apiBase: base, webBase: "http://web.test/", configPath },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  const client = new Client({ name: `test-${name}`, version: "0.0.0" });
  await client.connect(clientTransport);
  const call = async (tool: string, args: Args = {}) =>
    (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
  return {
    client,
    configPath,
    call,
    text: async (tool, args) => textOf(await call(tool, args)),
    close: async () => {
      await session.leave();
      await client.close();
      await mcp.close();
    },
  };
}

const line = (i: number): DrawOp => ({
  kind: "line",
  from: [i % 1000, 10],
  to: [(i * 7) % 1000, 990],
  width: 2,
  color: "#222222",
});

function must(re: RegExp, s: string): string {
  const m = re.exec(s);
  if (!m?.[1]) throw new Error(`pattern ${re} not found in:\n${s}`);
  return m[1];
}

describe("agent-pictionary MCP server", () => {
  it("lists every tool with an input schema", async () => {
    const s = await mcpSession("list");
    const { tools } = await s.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe("object");
    }
    const draw = tools.find((t) => t.name === "draw");
    expect(JSON.stringify(draw?.inputSchema)).toContain("ellipse");
    await s.close();
  });

  it("register_agent is idempotent, persists a 0600 file, and force re-registers", async () => {
    const s = await mcpSession("reg");
    expect(existsSync(s.configPath)).toBe(false);
    const first = await s.text("register_agent", { name: "Reggie", humanHandle: "h" });
    expect(first).toContain("Registered a new agent.");
    const agentId = must(/agentId: (\S+)/, first);
    const pair = must(/humanPairCode: (\S+)/, first);
    expect(statSync(s.configPath).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(readFileSync(s.configPath, "utf8"));
    expect(stored).toMatchObject({ agentId, humanPairCode: pair, name: "Reggie" });
    expect(stored.apiKey).toMatch(/^.+\..+$/);

    const second = await s.text("register_agent", { name: "Other", humanHandle: "h" });
    expect(second).toContain("Using the stored identity.");
    expect(must(/agentId: (\S+)/, second)).toBe(agentId);

    const forced = await s.text("register_agent", {
      name: "Reggie2",
      humanHandle: "h",
      force: true,
    });
    expect(must(/agentId: (\S+)/, forced)).not.toBe(agentId);
    await s.close();
  });

  it("errors are returned as isError text, never thrown", async () => {
    const s = await mcpSession("errors");
    const noId = await s.call("create_room");
    expect(noId.isError).toBe(true);
    expect(textOf(noId)).toContain("register_agent first");
    await s.text("register_agent", { name: "Err", humanHandle: "h" });
    const noRoom = await s.call("get_canvas_png");
    expect(noRoom.isError).toBe(true);
    expect(textOf(noRoom)).toContain("join_room first");
    expect(await s.text("get_state")).toContain("Not in a room");
    const missing = await s.call("join_room", { code: "ZZZZZZ" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("ROOM_NOT_FOUND");
    // Schema violation (a text op does not exist) is rejected before the handler runs.
    const badOp = await s.call("draw", { ops: [{ kind: "text", text: "cat" }] });
    expect(badOp.isError).toBe(true);
    await s.close();
  });

  it("two MCP sessions play a two-round match", async () => {
    const a = await mcpSession("alice");
    const b = await mcpSession("bob");
    await a.text("register_agent", { name: "Alice", humanHandle: "ha" });
    await b.text("register_agent", { name: "Bob", humanHandle: "hb" });

    const created = await a.text("create_room", {
      config: { chooseSeconds: 15, drawSeconds: 40, revealSeconds: 1 },
    });
    const code = must(/room code: (\S+)/, created);
    expect(created).toContain(`spectator URL: http://web.test/r/${code}`);

    const joinedA = await a.text("join_room", { code });
    expect(joinedA).toContain(`room ${code} · status lobby`);
    const joinedB = await b.text("join_room", { code: code.toLowerCase() });
    expect(joinedB).toContain("Alice");

    // wait_for_event times out cleanly in the lobby.
    const timeout = await a.call("wait_for_event", { types: ["match.ended"], timeoutSec: 1 });
    expect(timeout.isError).toBeUndefined();
    expect(textOf(timeout)).toMatch(/^timeout: no match\.ended event within 1s/);

    expect(await a.text("ready")).toContain("Ready");
    expect(await b.text("ready")).toContain("Ready");

    const [chA, chB] = await Promise.all([
      a.text("wait_for_event", { types: ["round.choosing"] }),
      b.text("wait_for_event", { types: ["round.choosing"] }),
    ]);
    expect(chA).toContain("[round.choosing] round 1:");
    expect(chB).toContain("[round.choosing] round 1:");
    const aDraws = chA.includes("(you) is choosing");
    const drawer = aDraws ? a : b;
    const guesser = aDraws ? b : a;
    const drawerName = aDraws ? "Alice" : "Bob";
    const guesserName = aDraws ? "Bob" : "Alice";

    // Drawer: options were buffered; choose the first.
    const opts = await drawer.text("wait_for_event", { types: ["round.wordOptions"] });
    expect(opts).toContain("[round.wordOptions] your word options: 0=");
    const word = must(/0="([^"]+)"/, opts);
    const chosen = await drawer.text("choose_word", { index: 0 });
    expect(chosen).toContain(`Chosen: "${word}"`);

    const startedG = await guesser.text("wait_for_event", { types: ["round.started"] });
    expect(startedG).toContain(`${drawerName} draws; pattern "`);
    expect(startedG).not.toContain(word);
    const startedD = await drawer.text("wait_for_event", { types: ["round.started"] });
    expect(startedD).toContain(`you draw "${word}"`);

    // get_state redaction: drawer sees the word, guesser sees the pattern.
    const stateD = await drawer.text("get_state");
    expect(stateD).toContain("your role: drawer");
    expect(stateD).toContain(`word: "${word}"`);
    const stateG = await guesser.text("get_state");
    expect(stateG).toContain("your role: guesser");
    expect(stateG).toContain('word pattern: "');
    expect(stateG).not.toContain(word);
    expect(stateG).toContain("your guesses remaining: 3");

    // Guesser may not draw.
    const notDrawer = await guesser.call("draw", { ops: [line(0)] });
    expect(notDrawer.isError).toBe(true);
    expect(textOf(notDrawer)).toContain("NOT_DRAWER");

    // Drawer draws 25 ops (two paced batches); guesser renders a PNG with them.
    const drew = await drawer.text("draw", { ops: Array.from({ length: 25 }, (_, i) => line(i)) });
    expect(drew).toContain("drew 25 ops: opSeq 1-25");
    // Erase needs the paid entitlement.
    const erase = await drawer.call("erase", { opSeq: 1 });
    expect(erase.isError).toBe(true);
    expect(textOf(erase)).toContain("ENTITLEMENT_REQUIRED");

    // Wait for the broadcast to reach the guesser, then render.
    let png: CallToolResult | undefined;
    for (let i = 0; i < 50; i++) {
      png = await guesser.call("get_canvas_png", { size: 128 });
      if (textOf(png).includes("last opSeq 25")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(png?.isError).toBeUndefined();
    const img = png?.content.find((c) => c.type === "image") as
      | { type: "image"; data: string; mimeType: string }
      | undefined;
    expect(img?.mimeType).toBe("image/png");
    const bytes = Buffer.from(img?.data ?? "", "base64");
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(textOf(png as CallToolResult)).toContain("25 visible ops (25 total, last opSeq 25)");

    // Guesses.
    const wrong = await guesser.text("guess", { text: "definitely-not-the-word" });
    expect(wrong).toContain("incorrect · 2 guesses left");
    const right = await guesser.text("guess", { text: word.toUpperCase() });
    expect(right).toContain("correct · ");
    expect(right).toContain("You solved it.");
    const endedG = await guesser.text("wait_for_event", { types: ["round.ended"] });
    expect(endedG).toContain(`the word was "${word}"`);
    expect(endedG).toContain(`winner ${guesserName} (you) (agent)`);
    const endedD = await drawer.text("wait_for_event", { types: ["round.ended"] });
    expect(endedD).toContain(`winner ${guesserName} (agent)`);

    // Round two: roles swap. The old guesser only waits for round.choosing and
    // gets the options inline.
    const ch2 = await guesser.text("wait_for_event", { types: ["round.choosing"] });
    expect(ch2).toContain("round 2:");
    expect(ch2).toContain("(you) is choosing a word — your options: 0=");
    const word2 = must(/1="([^"]+)"/, ch2);
    await guesser.text("choose_word", { index: 1 });
    expect(await drawer.text("wait_for_event", { types: ["round.started"] })).toContain(
      `${guesserName} draws`,
    );
    await guesser.text("draw", { ops: [line(1)] });
    const ok = await drawer.text("guess", { text: word2 });
    expect(ok).toContain("correct");
    const me = await drawer.text("wait_for_event", { types: ["match.ended"] });
    expect(me).toContain("[match.ended] match over; winner");
    expect(await drawer.text("get_state")).toContain("status finished");

    expect(await a.text("leave_room")).toBe(`left room ${code}`);
    expect(await a.text("leave_room")).toBe("not in a room");
    await a.close();
    await b.close();
  });
});

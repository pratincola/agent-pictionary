/**
 * Tool registry. Descriptions are written for an LLM player. Every handler
 * is wrapped so a failure becomes `{ isError: true }` text and never takes
 * the MCP server down. Results are compact text; `get_canvas_png` returns an
 * image content block.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DrawOp, PictionaryConfig } from "@pictionary/protocol";
import { ApiError, DisconnectedError, ProtocolError, TimeoutError } from "@pictionary/sdk";
import { z } from "zod";
import { spectatorUrl } from "./config.js";
import { formatEvent, formatState } from "./format.js";
import { type Session, WAITABLE_EVENT_TYPES } from "./session.js";

export const TOOL_NAMES = [
  "register_agent",
  "create_room",
  "join_room",
  "ready",
  "start_match",
  "get_state",
  "get_canvas_png",
  "wait_for_event",
  "choose_word",
  "custom_word",
  "draw",
  "erase",
  "clear_canvas",
  "guess",
  "leave_room",
] as const;

const MAX_WAIT_SEC = 120;
const DEFAULT_WAIT_SEC = 30;
const MAX_OPS_PER_CALL = 100;

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

export function errorText(err: unknown): string {
  if (err instanceof ProtocolError) {
    const ent = err.entitlement ? ` (needs the "${err.entitlement}" entitlement)` : "";
    return `${err.code}: ${err.message}${ent}`;
  }
  if (err instanceof ApiError) return `${err.code} (HTTP ${err.status}): ${err.message}`;
  if (err instanceof TimeoutError) return `TIMEOUT: ${err.message}`;
  if (err instanceof DisconnectedError) return `DISCONNECTED: ${err.message}; join_room again`;
  if (err instanceof z.ZodError) return `BAD_REQUEST: ${z.prettifyError(err)}`;
  if (err instanceof Error) return `${err.name === "Error" ? "ERROR" : err.name}: ${err.message}`;
  return `ERROR: ${String(err)}`;
}

function failure(err: unknown): CallToolResult {
  return { content: [{ type: "text", text: errorText(err) }], isError: true };
}

type Handler<A> = (args: A) => Promise<CallToolResult> | CallToolResult;

function safe<A>(fn: Handler<A>): Handler<A> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return failure(err);
    }
  };
}

const DRAW_DESCRIPTION = `Draw on the shared canvas (drawer only, during the drawing phase). The canvas is a 1000x1000 integer space: x grows to the right, y grows DOWN, (0,0) is the top-left corner. Op kinds:
- {kind:"path", points:[[x,y],...], width, color}  free stroke through up to 500 points
- {kind:"line", from:[x,y], to:[x,y], width, color}
- {kind:"rect", x, y, w, h, width, color, fill?}  x,y is the top-left corner
- {kind:"ellipse", cx, cy, rx, ry, width, color, fill?}
width is one of 1, 2, 4, 8, 12 (stroke thickness); color and fill are hex like "#000000". All numbers are integers inside the canvas. There is NO text op: writing letters or words on the canvas is against the rules. Up to ${MAX_OPS_PER_CALL} ops per call; the server allows 30 ops/s, so a call with 60 ops takes about 2 s. Draw the big shapes first in one call, then details in later calls, and check get_state for the seconds left. Returns the assigned opSeq range (use these numbers with erase).`;

export function registerTools(server: McpServer, session: Session): void {
  server.registerTool(
    "register_agent",
    {
      title: "Register this agent",
      description:
        "Create (once) this agent's identity on the arena server and store it in the local config file so you keep the same id across sessions. Returns the agentId and a humanPairCode. Tell your human to paste the pair code in the web UI: that pairs them with you so they can watch and add extra guesses when yours run out. If an identity is already stored, it is returned unchanged unless force=true.",
      inputSchema: {
        name: z.string().trim().min(1).max(40).describe("Your display name, e.g. 'Claude'"),
        humanHandle: z.string().trim().min(1).max(40).describe("Your human's handle"),
        force: z.boolean().optional().describe("Register a new identity even if one is stored"),
      },
    },
    safe(async ({ name, humanHandle, force }) => {
      const { identity, created } = await session.register({ name, humanHandle }, force ?? false);
      return text(
        [
          created ? "Registered a new agent." : "Using the stored identity.",
          `agentId: ${identity.agentId}`,
          `name: ${identity.name}`,
          `humanPairCode: ${identity.humanPairCode}`,
          `config file: ${session.config.configPath}`,
          "Give the pair code to your human: they enter it in the web UI to pair with you.",
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "create_room",
    {
      title: "Create a room",
      description:
        "Create a new Pictionary room on the arena server. You become the room creator (you may start_match). Returns the room code and the spectator URL to share with humans. You are NOT in the room yet: call join_room with the code next.",
      inputSchema: {
        config: PictionaryConfig.partial()
          .optional()
          .describe(
            "Optional overrides: roundsPerPlayer (1-5), chooseSeconds, drawSeconds, revealSeconds, guessesPerAgent, humanGuessesPerRound, minPlayers, maxPlayers, firstCorrectEnds",
          ),
      },
    },
    safe(async ({ config }) => {
      const room = await session.createRoom(config);
      return text(
        [
          `room code: ${room.code}`,
          `spectator URL: ${spectatorUrl(session.config.webBase, room.code)}`,
          "Next: join_room with this code, then ready.",
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "join_room",
    {
      title: "Join a room",
      description:
        "Join a room by its code as this agent (register_agent first). Opens the live connection. Returns the current state. If you are already in another room you leave it first.",
      inputSchema: {
        code: z.string().trim().min(4).max(8).describe("Room code, e.g. 'ABCD12'"),
      },
    },
    safe(async ({ code }) => {
      const { state, left } = await session.join(code);
      const prefix = left ? `Left room ${left}.\n` : "";
      return text(`${prefix}Joined.\n${formatState(state, session.pendingEventTypes())}`);
    }),
  );

  server.registerTool(
    "ready",
    {
      title: "Mark yourself ready",
      description:
        "Tell the room you are ready to play (lobby only). The match starts automatically once every connected player is ready and the minimum player count is met. Then call wait_for_event for round.choosing / round.wordOptions / round.started.",
      inputSchema: {},
    },
    safe(async () => {
      await session.requireClient().ready();
      return text(
        "Ready. Now wait_for_event for round.choosing, round.wordOptions or round.started.",
      );
    }),
  );

  server.registerTool(
    "start_match",
    {
      title: "Start the match",
      description:
        "Force the match to start with the players currently connected (room creator only, lobby only). Usually unnecessary: ready is enough once everyone is ready.",
      inputSchema: {},
    },
    safe(async () => {
      await session.requireClient().start();
      return text("Match start requested. wait_for_event for round.choosing / round.wordOptions.");
    }),
  );

  server.registerTool(
    "get_state",
    {
      title: "Get room state",
      description:
        "Compact view of the room: phase, your role (drawer or guesser), round index, seconds left, your word (drawer) or the word pattern (guesser), canvas op count, guesses remaining, scores and players. Cheap; call it whenever you need to orient.",
      inputSchema: {},
    },
    safe(() => text(formatState(session.state, session.pendingEventTypes()))),
  );

  server.registerTool(
    "get_canvas_png",
    {
      title: "Look at the canvas",
      description:
        "Render the current canvas as a PNG image (what spectators see). Guessers: look at it, then call guess. Drawers: use it to check your work. Rendering is local and free; the canvas only changes when the drawer sends ops, so about every 8 seconds is enough.",
      inputSchema: {
        size: z
          .number()
          .int()
          .min(64)
          .max(1024)
          .optional()
          .describe("Output width/height in pixels (default 512)"),
      },
    },
    safe(({ size }) => {
      const client = session.requireClient();
      const state = client.state;
      const ops = state?.round?.ops ?? [];
      const visible = ops.filter((e) => !e.erased).length;
      const png = client.renderPng({ size: size ?? 512 });
      const phase = state?.round
        ? `${state.round.phase}, ${client.secondsLeft()}s left`
        : "no round";
      return {
        content: [
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
          {
            type: "text",
            text: `canvas: ${visible} visible ops (${ops.length} total, last opSeq ${client.lastOpSeq()}) · ${phase}`,
          },
        ],
      };
    }),
  );

  server.registerTool(
    "wait_for_event",
    {
      title: "Wait for a game event",
      description: `Block until the next event of one of the given types arrives (or the timeout passes), then return a one-line summary. Events that already arrived and were not yet returned are delivered at once. Typical loop: wait_for_event ["round.wordOptions","round.started","round.ended","match.ended"]. Drawer: round.wordOptions -> choose_word -> round.started -> draw. Guesser: round.started -> get_canvas_png + guess. Types: ${WAITABLE_EVENT_TYPES.join(", ")}. On timeout the text starts with "timeout"; call get_state to orient.`,
      inputSchema: {
        types: z
          .array(z.enum(WAITABLE_EVENT_TYPES))
          .min(1)
          .describe("Event types to wait for; the first matching one is returned"),
        timeoutSec: z
          .number()
          .min(1)
          .max(MAX_WAIT_SEC)
          .optional()
          .describe(`Seconds to wait (default ${DEFAULT_WAIT_SEC}, max ${MAX_WAIT_SEC})`),
      },
    },
    safe(async ({ types, timeoutSec }) => {
      session.requireClient();
      const secs = Math.min(MAX_WAIT_SEC, timeoutSec ?? DEFAULT_WAIT_SEC);
      const e = await session.waitForEvent(types, secs * 1000);
      if (!e) return text(`timeout: no ${types.join("/")} event within ${secs}s`);
      return text(formatEvent(e, session.state));
    }),
  );

  server.registerTool(
    "choose_word",
    {
      title: "Choose your word",
      description:
        "Drawer, choosing phase: pick one of the three offered words by index (0, 1 or 2; see round.wordOptions or get_state). Harder words are no more points; pick what you can draw. The round starts right after.",
      inputSchema: { index: z.union([z.literal(0), z.literal(1), z.literal(2)]) },
    },
    safe(async ({ index }) => {
      const client = session.requireClient();
      await client.chooseWord(index);
      return text(`Chosen: "${client.word() ?? "?"}". wait_for_event round.started, then draw.`);
    }),
  );

  server.registerTool(
    "custom_word",
    {
      title: "Bring your own word",
      description:
        "Drawer, choosing phase: use your own word instead of the offered ones (1-3 words, letters only). Requires the paid custom_word entitlement; without it the server answers ENTITLEMENT_REQUIRED.",
      inputSchema: { word: z.string().trim().min(2).max(64) },
    },
    safe(async ({ word }) => {
      await session.requireClient().customWord(word);
      return text(
        `Custom word accepted: "${word.trim().toLowerCase()}". wait_for_event round.started.`,
      );
    }),
  );

  server.registerTool(
    "draw",
    {
      title: "Draw",
      description: DRAW_DESCRIPTION,
      inputSchema: { ops: z.array(DrawOp).min(1).max(MAX_OPS_PER_CALL) },
    },
    safe(async ({ ops }) => {
      const client = session.requireClient();
      const parsed = z.array(DrawOp).parse(ops);
      const res = await client.draw(parsed);
      return text(
        `drew ${parsed.length} ops: opSeq ${res.opSeqFrom}-${res.opSeqTo} · ${client.secondsLeft()}s left`,
      );
    }),
  );

  server.registerTool(
    "erase",
    {
      title: "Erase one op",
      description:
        "Drawer: remove one op by its opSeq (from a draw result). Requires the paid erase entitlement; otherwise ENTITLEMENT_REQUIRED.",
      inputSchema: { opSeq: z.number().int().positive() },
    },
    safe(async ({ opSeq }) => {
      await session.requireClient().erase(opSeq);
      return text(`erased op ${opSeq}`);
    }),
  );

  server.registerTool(
    "clear_canvas",
    {
      title: "Clear the canvas",
      description:
        "Drawer: erase everything drawn this round. Requires the paid erase entitlement; otherwise ENTITLEMENT_REQUIRED.",
      inputSchema: {},
    },
    safe(async () => {
      await session.requireClient().clear();
      return text("canvas cleared");
    }),
  );

  server.registerTool(
    "guess",
    {
      title: "Guess the word",
      description:
        "Guesser, drawing phase: submit one guess (a word or short phrase; case and articles do not matter). Returns correct / incorrect / close (one letter off) and how many guesses you have left. You get a limited number per round (default 3), so look at the canvas first. After your last guess your human may add extra guesses in the web UI.",
      inputSchema: { text: z.string().trim().min(1).max(64) },
    },
    safe(async ({ text: t }) => {
      const client = session.requireClient();
      const r = await client.guess(t);
      const tail =
        r.result === "correct"
          ? "You solved it."
          : r.result === "close"
            ? "Close: one letter off."
            : r.result === "incorrect"
              ? ""
              : "The round is already over.";
      return text(
        `guess "${t}": ${r.result} · ${r.remaining} guesses left${tail ? ` · ${tail}` : ""}`,
      );
    }),
  );

  server.registerTool(
    "leave_room",
    {
      title: "Leave the room",
      description: "Close the connection to the current room. Your identity is kept.",
      inputSchema: {},
    },
    safe(async () => {
      const code = session.client?.code;
      await session.leave();
      return text(code ? `left room ${code}` : "not in a room");
    }),
  );
}

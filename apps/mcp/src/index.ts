/**
 * Programmatic entry: build an MCP server bound to one Session. `main.ts`
 * connects it to stdio; tests connect it to an InMemoryTransport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configFromEnv, type McpConfig } from "./config.js";
import { Session } from "./session.js";
import { registerTools } from "./tools.js";

export type { McpConfig } from "./config.js";
export {
  configFromEnv,
  defaultConfigPath,
  Identity,
  loadIdentity,
  saveIdentity,
} from "./config.js";
export { Session, WAITABLE_EVENT_TYPES } from "./session.js";
export { TOOL_NAMES } from "./tools.js";

export const SERVER_NAME = "agent-pictionary";
export const SERVER_VERSION = "0.1.0";

export interface CreateServerOptions {
  config?: McpConfig;
  /** Diagnostics sink (stderr in main.ts). Never stdout: that is the MCP channel. */
  log?: (msg: string) => void;
}

export function createMcpServer(opts: CreateServerOptions = {}): {
  server: McpServer;
  session: Session;
} {
  const config = opts.config ?? configFromEnv();
  const session = new Session(config, opts.log);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "You are an agent playing Pictionary in an arena where humans watch. Call register_agent once, then create_room or join_room, then ready. Loop on wait_for_event. As drawer: choose_word, then draw in several calls (no letters!). As guesser: get_canvas_png, then guess (3 per round). Use get_state whenever unsure.",
    },
  );
  registerTools(server, session);
  return { server, session };
}

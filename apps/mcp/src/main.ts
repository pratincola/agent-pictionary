#!/usr/bin/env node
/**
 * stdio entry point: `agent-pictionary-mcp`. All diagnostics go to stderr;
 * stdout carries only MCP frames.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./index.js";

const log = (msg: string): void => {
  process.stderr.write(`[agent-pictionary-mcp] ${msg}\n`);
};

async function main(): Promise<void> {
  const { server, session } = createMcpServer({ log });
  log(
    `api ${session.config.apiBase} · web ${session.config.webBase} · config ${session.config.configPath}`,
  );
  const transport = new StdioServerTransport();
  const shutdown = async (): Promise<void> => {
    await session.leave().catch(() => {});
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  transport.onclose = () => void shutdown();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  log(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});

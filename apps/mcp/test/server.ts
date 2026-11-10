/**
 * Starts the real arena server in-process for MCP tests. Own database
 * (`pictionary_mcp`) and port (3300) so it can run next to the server and SDK
 * suites. Create the database once: `createdb -h /tmp -p 5433 pictionary_mcp`.
 */
import { type ArenaServer, buildServer } from "@pictionary/server";

export const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/pictionary_mcp";
export const TEST_PORT = Number(process.env.MCP_TEST_PORT ?? 3300);
export const ADMIN_TOKEN = "test-admin-token";

export async function startTestServer(port = TEST_PORT): Promise<ArenaServer> {
  const server = await buildServer({
    databaseUrl: TEST_DB_URL,
    host: "127.0.0.1",
    port,
    logLevel: (process.env.TEST_LOG_LEVEL as "info" | undefined) ?? "silent",
    validateOutgoing: true,
    sessionSecret: "test-secret-test-secret-test-secret",
    adminToken: ADMIN_TOKEN,
    outboxRetryMs: 500,
  });
  await server.listen();
  return server;
}

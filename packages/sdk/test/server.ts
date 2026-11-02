/**
 * Starts the real arena server in-process for SDK integration tests.
 * Uses its own database (`pictionary_agents`) and port (3200) so it can run
 * next to the server's own test suite.
 */
import { type ArenaServer, buildServer } from "@pictionary/server";

export const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/pictionary_agents";
export const TEST_PORT = Number(process.env.SDK_TEST_PORT ?? 3200);
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

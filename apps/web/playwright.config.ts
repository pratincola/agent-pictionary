import path from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * E2E: a real arena server on its own port and database, the production
 * build served by `vite preview` (which proxies /api/v1 and /ws like Caddy
 * will), scripted bots over the server's WebSocket, Chromium as the audience.
 *
 * Env:
 *   E2E_DATABASE_URL  default postgres://postgres@localhost:5433/pictionary_web
 *   E2E_SERVER_PORT   default 3100
 *   E2E_WEB_PORT      default 4273
 */
const root = path.resolve(import.meta.dirname, "../..");
const dbUrl = process.env.E2E_DATABASE_URL ?? "postgres://postgres@localhost:5433/pictionary_web";
const serverPort = Number(process.env.E2E_SERVER_PORT ?? 3100);
const webPort = Number(process.env.E2E_WEB_PORT ?? 4273);

export const E2E = {
  serverBase: `http://127.0.0.1:${serverPort}`,
  webBase: `http://127.0.0.1:${webPort}`,
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: E2E.webBase,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      // tsc -b is incremental: a no-op when dist/ is current.
      command: `pnpm build && node apps/server/dist/main.js`,
      cwd: root,
      url: `${E2E.serverBase}/healthz`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        DATABASE_URL: dbUrl,
        HOST: "127.0.0.1",
        PORT: String(serverPort),
        LOG_LEVEL: process.env.E2E_SERVER_LOG ?? "warn",
      },
    },
    {
      command: `pnpm build && pnpm exec vite preview --port ${webPort} --strictPort --host 127.0.0.1`,
      cwd: import.meta.dirname,
      url: E2E.webBase,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { VITE_API_BASE: E2E.serverBase },
    },
  ],
});

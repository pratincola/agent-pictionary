/**
 * Configuration and the persisted agent identity.
 *
 * Env:
 * - AP_API_BASE  arena server root (default http://localhost:8080)
 * - AP_WEB_BASE  spectator web UI root (default http://localhost:5173)
 * - AP_CONFIG    identity file (default ~/.agent-pictionary/agent.json)
 *
 * The identity file holds `{ agentId, apiKey, name, humanPairCode }` so an
 * agent keeps the same id (and leaderboard history) across MCP sessions. It
 * contains the api key, so it is written with mode 0600 in a 0700 directory.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export const DEFAULT_API_BASE = "http://localhost:8080";
export const DEFAULT_WEB_BASE = "http://localhost:5173";

export interface McpConfig {
  /** Arena server root, e.g. http://localhost:8080 */
  apiBase: string;
  /** Spectator UI root, e.g. http://localhost:5173 */
  webBase: string;
  /** Path of the identity file. */
  configPath: string;
}

export const Identity = z.object({
  agentId: z.string().min(1),
  apiKey: z.string().min(1),
  name: z.string().min(1),
  humanPairCode: z.string().min(1),
});
export type Identity = z.infer<typeof Identity>;

export function defaultConfigPath(): string {
  return join(homedir(), ".agent-pictionary", "agent.json");
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Build the config from the environment (or an override map, for tests). */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig {
  return {
    apiBase: stripSlash(env.AP_API_BASE || DEFAULT_API_BASE),
    webBase: stripSlash(env.AP_WEB_BASE || DEFAULT_WEB_BASE),
    configPath: env.AP_CONFIG || defaultConfigPath(),
  };
}

/** Read the identity file. Returns undefined when it is missing or unreadable. */
export function loadIdentity(path: string): Identity | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = Identity.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Write the identity file atomically with mode 0600 (directory 0700). */
export function saveIdentity(path: string, identity: Identity): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Spectator URL for a room code. */
export function spectatorUrl(webBase: string, code: string): string {
  return `${stripSlash(webBase)}/r/${encodeURIComponent(code.toUpperCase())}`;
}

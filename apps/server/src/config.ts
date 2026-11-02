import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().default("postgres://postgres@localhost:5433/pictionary_test"),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(8080),
  PUBLIC_WS_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(16).default("dev-only-secret-change-me-please"),
  ADMIN_TOKEN: z.string().min(8).default("dev-admin-token"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
});

export interface ServerConfig {
  databaseUrl: string;
  redisUrl: string;
  host: string;
  port: number;
  /** Base URL used in wsUrl; derived from the listen address when unset. */
  publicWsUrl?: string;
  sessionSecret: string;
  adminToken: string;
  logLevel: z.infer<typeof Env>["LOG_LEVEL"];
  /** Session token lifetime in ms. */
  sessionTtlMs: number;
  /** draw.ops rate limit per drawer session (ops per second). */
  drawOpsPerSecond: number;
  /** Validate every outgoing WS message against the protocol schema (tests). */
  validateOutgoing: boolean;
  /** Outbox retry interval. */
  outboxRetryMs: number;
  nodeId: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const e = Env.parse(env);
  const cfg: ServerConfig = {
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    host: e.HOST,
    port: e.PORT,
    sessionSecret: e.SESSION_SECRET,
    adminToken: e.ADMIN_TOKEN,
    logLevel: e.LOG_LEVEL,
    sessionTtlMs: 24 * 60 * 60 * 1000,
    drawOpsPerSecond: 30,
    validateOutgoing: false,
    outboxRetryMs: 5_000,
    nodeId: `node-${process.pid}`,
  };
  if (e.PUBLIC_WS_URL) cfg.publicWsUrl = e.PUBLIC_WS_URL;
  return cfg;
}

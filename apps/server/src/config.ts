import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().default("postgres://postgres@localhost:5433/pictionary_test"),
  /** Unset = single node, in-memory directory and bus (Phase 1 behaviour). */
  REDIS_URL: z.string().optional(),
  NODE_ID: z.string().min(1).optional(),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(8080),
  PUBLIC_WS_URL: z.string().optional(),
  PUBLIC_REST_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(16).default("dev-only-secret-change-me-please"),
  ADMIN_TOKEN: z.string().min(8).default("dev-admin-token"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  ROOM_TTL_MS: z.coerce.number().int().positive().default(15_000),
  RATE_LIMIT_AGENTS_PER_MIN: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_ROOMS_PER_MIN: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_CANVAS_PER_SEC: z.coerce.number().int().positive().default(1),
});

export interface RateLimitConfig {
  /** POST /agents per client IP per minute. */
  agentsPerMinute: number;
  /** POST /rooms per client IP per minute. */
  roomsPerMinute: number;
  /** GET /rooms/:code/canvas.png per session per second. */
  canvasPerSecond: number;
}

export interface ServerConfig {
  databaseUrl: string;
  /** When set, the Redis room directory, event bus and snapshot store are used. */
  redisUrl?: string;
  host: string;
  port: number;
  /** Base URL used in wsUrl; derived from the listen address when unset. */
  publicWsUrl?: string;
  /** Base URL other nodes redirect to for REST; derived from publicWsUrl or the listen address. */
  publicRestUrl?: string;
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
  /** Directory entry TTL; the heartbeat renews it every ttl/3. */
  roomTtlMs: number;
  rateLimit: RateLimitConfig;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const e = Env.parse(env);
  const cfg: ServerConfig = {
    databaseUrl: e.DATABASE_URL,
    host: e.HOST,
    port: e.PORT,
    sessionSecret: e.SESSION_SECRET,
    adminToken: e.ADMIN_TOKEN,
    logLevel: e.LOG_LEVEL,
    sessionTtlMs: 24 * 60 * 60 * 1000,
    drawOpsPerSecond: 30,
    validateOutgoing: false,
    outboxRetryMs: 5_000,
    nodeId: e.NODE_ID ?? `node-${process.pid}`,
    roomTtlMs: e.ROOM_TTL_MS,
    rateLimit: {
      agentsPerMinute: e.RATE_LIMIT_AGENTS_PER_MIN,
      roomsPerMinute: e.RATE_LIMIT_ROOMS_PER_MIN,
      canvasPerSecond: e.RATE_LIMIT_CANVAS_PER_SEC,
    },
  };
  if (e.REDIS_URL) cfg.redisUrl = e.REDIS_URL;
  if (e.PUBLIC_WS_URL) cfg.publicWsUrl = e.PUBLIC_WS_URL;
  if (e.PUBLIC_REST_URL) cfg.publicRestUrl = e.PUBLIC_REST_URL;
  return cfg;
}

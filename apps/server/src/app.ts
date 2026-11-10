import rateLimit from "@fastify/rate-limit";
import type { RoomStateSnapshot } from "@pictionary/protocol";
import Fastify, { type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { type Logger, pino } from "pino";
import type { WebSocketServer } from "ws";
import { configFromEnv, type ServerConfig } from "./config.js";
import { createDb, type Db, runMigrations, type Sql } from "./db/index.js";
import { Metrics } from "./metrics.js";
import { Repo } from "./repo.js";
import {
  type EventBus,
  InMemoryEventBus,
  InMemoryRoomDirectory,
  InMemorySnapshotStore,
  type NodeInfo,
  type RoomDirectory,
  type SnapshotStore,
} from "./rooms/infra.js";
import { RoomManager } from "./rooms/manager.js";
import { Persistence } from "./rooms/persistence.js";
import {
  createRedis,
  RedisEventBus,
  RedisRoomDirectory,
  RedisSnapshotStore,
} from "./rooms/redis.js";
import { registerRoutes } from "./routes/index.js";
import { attachWebSocket } from "./ws.js";

export interface ArenaServer {
  app: FastifyInstance;
  config: ServerConfig;
  log: Logger;
  db: Db;
  sql: Sql;
  repo: Repo;
  rooms: RoomManager;
  persistence: Persistence;
  metrics: Metrics;
  /** Set when REDIS_URL is configured. */
  redis: Redis | undefined;
  wss: WebSocketServer;
  /** http://host:port after listen(). */
  baseUrl: string;
  wsBase: string;
  /** Public REST base other nodes redirect to. */
  restBase: string;
  /** True once close() started: /readyz is 503 and new rooms/sessions are refused. */
  readonly shuttingDown: boolean;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export async function buildServer(
  overrides: Partial<ServerConfig> = {},
  env = process.env,
): Promise<ArenaServer> {
  const config: ServerConfig = { ...configFromEnv(env), ...overrides };
  const log = pino({ level: config.logLevel, base: { node: config.nodeId } });
  const { sql, db } = createDb(config.databaseUrl);
  await runMigrations(db);
  const repo = new Repo(db);
  const persistence = new Persistence(db, log, config.outboxRetryMs);

  let redis: Redis | undefined;
  let bus: EventBus;
  let directory: RoomDirectory;
  let snapshots: SnapshotStore;
  if (config.redisUrl) {
    redis = createRedis(config.redisUrl, log, "ap-main");
    directory = new RedisRoomDirectory(redis, config.roomTtlMs);
    bus = new RedisEventBus(redis, config.redisUrl, log);
    snapshots = new RedisSnapshotStore(redis);
  } else {
    bus = new InMemoryEventBus();
    directory = new InMemoryRoomDirectory();
    snapshots = new InMemorySnapshotStore();
  }

  let shuttingDown = false;
  const metrics: Metrics = new Metrics(config.nodeId, {
    queueDepth: (): number => rooms.queueDepth(),
  });
  const rooms: RoomManager = new RoomManager({
    log,
    repo,
    persistence,
    bus,
    directory,
    snapshots,
    metrics,
    nodeId: config.nodeId,
    validateOutgoing: config.validateOutgoing,
    roomTtlMs: config.roomTtlMs,
    fetchRemoteSnapshot: (node, code) => fetchSnapshot(node, code),
  });

  // Request/response logs only at debug level; errors always pass through.
  const httpLog = log.child(
    { component: "http" },
    { level: config.logLevel === "debug" ? "debug" : "warn" },
  );
  const app: FastifyInstance = Fastify({
    loggerInstance: httpLog,
    trustProxy: true,
  }) as unknown as FastifyInstance;
  await app.register(rateLimit, {
    global: false,
    ...(redis ? { redis } : {}),
    nameSpace: "ap-rl:",
    onExceeded: (req) => metrics.restRateLimited.inc({ route: req.routeOptions.url ?? "?" }),
  });

  const server: ArenaServer = {
    app,
    config,
    log,
    db,
    sql,
    repo,
    rooms,
    persistence,
    metrics,
    redis,
    wss: undefined as unknown as WebSocketServer,
    baseUrl: "",
    wsBase: config.publicWsUrl ?? "",
    restBase: config.publicRestUrl ?? "",
    get shuttingDown() {
      return shuttingDown;
    },
    async listen() {
      await app.listen({ host: config.host, port: config.port });
      const addr = app.server.address();
      const port = typeof addr === "object" && addr ? addr.port : config.port;
      const host = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
      server.baseUrl = `http://${host}:${port}`;
      if (!config.publicWsUrl) server.wsBase = `ws://${host}:${port}`;
      if (!config.publicRestUrl)
        server.restBase = config.publicWsUrl
          ? config.publicWsUrl.replace(/^ws/, "http")
          : server.baseUrl;
      persistence.start();
      const node: NodeInfo = {
        nodeId: config.nodeId,
        restBase: server.restBase,
        wsBase: server.wsBase,
      };
      await rooms.start(node);
      log.info({ baseUrl: server.baseUrl, node }, "listening");
      return server.baseUrl;
    },
    async close() {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info("shutting down: draining rooms");
      // 1. Rooms: drain actor queues, snapshot, release directory entries.
      await rooms.closeAll();
      // 2. Sockets and the HTTP listener (new connections are refused from here on).
      server.wss.close();
      await app.close();
      // 3. Flush the outbox, then drop the backing connections.
      await persistence.stop();
      await bus.close();
      await directory.close();
      if (redis) await redis.quit().catch(() => {});
      await sql.end({ timeout: 5 });
    },
  };
  registerRoutes(app, {
    config,
    repo,
    rooms,
    metrics,
    redis,
    wsBase: () => server.wsBase,
    isShuttingDown: () => shuttingDown,
  });
  server.wss = attachWebSocket(app.server, { config, log, repo, rooms, metrics });
  return server;
}

/** Spectator snapshot of a room from its owning node (public information). */
async function fetchSnapshot(node: NodeInfo, code: string): Promise<RoomStateSnapshot | null> {
  const res = await fetch(`${node.restBase}/rooms/${encodeURIComponent(code)}/snapshot`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`snapshot fetch from ${node.nodeId} failed: ${res.status}`);
  return (await res.json()) as RoomStateSnapshot;
}

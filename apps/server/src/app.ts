import Fastify, { type FastifyInstance } from "fastify";
import { type Logger, pino } from "pino";
import type { WebSocketServer } from "ws";
import { configFromEnv, type ServerConfig } from "./config.js";
import { createDb, type Db, runMigrations, type Sql } from "./db/index.js";
import { Repo } from "./repo.js";
import { InMemoryEventBus, InMemoryRoomDirectory } from "./rooms/infra.js";
import { RoomManager } from "./rooms/manager.js";
import { Persistence } from "./rooms/persistence.js";
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
  wss: WebSocketServer;
  /** http://host:port after listen(). */
  baseUrl: string;
  wsBase: string;
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
  const bus = new InMemoryEventBus();
  const directory = new InMemoryRoomDirectory();
  const rooms = new RoomManager({
    log,
    repo,
    persistence,
    bus,
    directory,
    nodeId: config.nodeId,
    validateOutgoing: config.validateOutgoing,
  });

  // Request/response logs only at debug level; errors always pass through.
  const httpLog = log.child(
    { component: "http" },
    { level: config.logLevel === "debug" ? "debug" : "warn" },
  );
  const app: FastifyInstance = Fastify({ loggerInstance: httpLog }) as unknown as FastifyInstance;
  const server: ArenaServer = {
    app,
    config,
    log,
    db,
    sql,
    repo,
    rooms,
    persistence,
    wss: undefined as unknown as WebSocketServer,
    baseUrl: "",
    wsBase: config.publicWsUrl ?? "",
    async listen() {
      await app.listen({ host: config.host, port: config.port });
      const addr = app.server.address();
      const port = typeof addr === "object" && addr ? addr.port : config.port;
      const host = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
      server.baseUrl = `http://${host}:${port}`;
      if (!config.publicWsUrl) server.wsBase = `ws://${host}:${port}`;
      persistence.start();
      log.info({ baseUrl: server.baseUrl }, "listening");
      return server.baseUrl;
    },
    async close() {
      log.info("shutting down");
      await rooms.closeAll();
      server.wss.close();
      await app.close();
      await persistence.stop();
      await sql.end({ timeout: 5 });
    },
  };
  registerRoutes(app, { config, repo, rooms, wsBase: () => server.wsBase });
  server.wss = attachWebSocket(app.server, { config, log, repo, rooms });
  return server;
}

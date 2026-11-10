import { roomPublic, viewerOf, viewRoom } from "@pictionary/engine";
import {
  type AgentPublic,
  CreateAgentBody,
  type CreateAgentResponse,
  CreateRoomBody,
  type CreateRoomResponse,
  CreateSessionBody,
  type CreateSessionResponse,
  type Entitlement,
  EntitlementsBody,
  OpsQuery,
  type OpsResponse,
  PictionaryConfig,
} from "@pictionary/protocol";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { newId, signSessionToken } from "../auth.js";
import type { ServerConfig } from "../config.js";
import type { Metrics } from "../metrics.js";
import type { Repo } from "../repo.js";
import type { RoomActor } from "../rooms/actor.js";
import type { RoomManager } from "../rooms/manager.js";
import { bearer, HttpError, parseBody, sendError } from "./util.js";

export interface RouteDeps {
  config: ServerConfig;
  repo: Repo;
  rooms: RoomManager;
  metrics: Metrics;
  redis: Redis | undefined;
  /** Resolves the public ws base URL once the server listens. */
  wsBase: () => string;
  isShuttingDown: () => boolean;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { repo, rooms, config, metrics } = deps;
  const rl = config.rateLimit;
  const perIp = (max: number, timeWindow: string) => ({
    config: { rateLimit: { max, timeWindow } },
  });

  /**
   * Local actor for a room code, or a 307 to the owning node for anything
   * that must reach the single writer (PLAN.md §9.6). Spectator session
   * creation is served locally (relay), see /sessions.
   */
  async function localOrRedirect(
    code: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<RoomActor | null> {
    const loc = await rooms.locate(code);
    if (loc.kind === "local") return loc.actor;
    if (loc.kind === "remote") {
      const url = req.url.startsWith("/") ? req.url : `/${req.url}`;
      void reply.status(307).header("location", `${loc.node.restBase}${url}`).send();
      return null;
    }
    throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
  }

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof HttpError) return sendError(reply, err);
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const message = err instanceof Error ? err.message : "bad request";
      return reply.status(status).send({ error: { code: "BAD_REQUEST", message } });
    }
    app.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "INTERNAL", message: "internal error" } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "BAD_REQUEST", message: "route not found" } }),
  );

  app.get("/healthz", async (_req, reply) => {
    const ok = await repo.ping();
    if (!ok)
      return reply
        .status(503)
        .send({ error: { code: "INTERNAL", message: "database unavailable" } });
    return { ok: true as const };
  });

  /** Ready to take traffic: DB up, Redis up when configured, not shutting down. */
  app.get("/readyz", async (_req, reply) => {
    const checks: Record<string, boolean> = { db: await repo.ping() };
    if (deps.redis) {
      checks.redis = await deps.redis
        .ping()
        .then((r) => r === "PONG")
        .catch(() => false);
    }
    checks.accepting = !deps.isShuttingDown();
    const ok = Object.values(checks).every(Boolean);
    return reply.status(ok ? 200 : 503).send({ ok, node: config.nodeId, checks });
  });

  app.get("/metrics", async (_req, reply) => {
    return reply.header("content-type", metrics.registry.contentType).send(await metrics.render());
  });

  // --- agents ---------------------------------------------------------------

  app.post("/agents", perIp(rl.agentsPerMinute, "1 minute"), async (req, reply) => {
    const body = parseBody(CreateAgentBody, req.body);
    const res: CreateAgentResponse = await repo.createAgent(body.name, body.humanHandle);
    return reply.status(201).send(res);
  });

  app.get<{ Params: { id: string } }>("/agents/:id", async (req) => {
    const agent = await repo.getAgent(req.params.id).catch(() => null);
    if (!agent) throw new HttpError(404, "BAD_REQUEST", "agent not found");
    const stats = await repo.getAgentStats(agent.id);
    const out: AgentPublic = {
      id: agent.id,
      name: agent.name,
      tier: agent.tier,
      entitlements: agent.entitlements,
      stats,
    };
    return out;
  });

  // --- rooms ----------------------------------------------------------------

  app.post("/rooms", perIp(rl.roomsPerMinute, "1 minute"), async (req, reply) => {
    if (deps.isShuttingDown()) throw new HttpError(503, "INTERNAL", "node is shutting down");
    const body = parseBody(CreateRoomBody, req.body);
    const config = PictionaryConfig.parse(body.config ?? {});
    if (config.minPlayers > config.maxPlayers)
      throw new HttpError(400, "BAD_REQUEST", "minPlayers > maxPlayers");
    const key = bearer(req);
    let creatorAgentId: string | undefined;
    let creatorHumanId: string | undefined;
    if (key) {
      const agent = await repo.authenticateAgent(key);
      if (!agent) throw new HttpError(401, "UNAUTHORIZED", "invalid api key");
      creatorAgentId = agent.id;
      creatorHumanId = agent.humanId;
    }
    const actor = await rooms.create({
      config,
      ...(creatorAgentId ? { creatorAgentId } : {}),
      ...(creatorHumanId ? { creatorHumanId } : {}),
    });
    const res: CreateRoomResponse = { code: actor.code, roomId: actor.roomId };
    return reply.status(201).send(res);
  });

  app.get<{ Params: { code: string } }>("/rooms/:code", async (req, reply) => {
    const actor = await localOrRedirect(req.params.code.toUpperCase(), req, reply);
    if (!actor) return reply;
    return roomPublic(actor.peek());
  });

  /** Spectator-redacted snapshot; relay nodes fetch this once per attaching spectator. */
  app.get<{ Params: { code: string } }>("/rooms/:code/snapshot", async (req) => {
    const actor = rooms.get(req.params.code.toUpperCase());
    if (!actor) throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
    return viewRoom(actor.peek(), viewerOf({ sessionId: "relay", role: "spectator" }));
  });

  app.post<{ Params: { code: string } }>("/rooms/:code/sessions", async (req, reply) => {
    if (deps.isShuttingDown()) throw new HttpError(503, "INTERNAL", "node is shutting down");
    const code = req.params.code.toUpperCase();
    const body = parseBody(CreateSessionBody, req.body);
    const loc = await rooms.locate(code);
    if (loc.kind === "none") throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
    const sid = newId();
    if (loc.kind === "remote") {
      if (body.role !== "spectator") {
        // Players and humans must talk to the single writer.
        return reply.status(307).header("location", `${loc.node.restBase}${req.url}`).send();
      }
      // Spectators attach here and get the owner's broadcasts over the bus.
      await repo.createSession({ id: sid, roomId: await roomIdOf(code), role: "spectator" });
      const token = signSessionToken(
        { sid, code, role: "spectator", exp: Date.now() + config.sessionTtlMs },
        config.sessionSecret,
      );
      const res: CreateSessionResponse = {
        sessionId: sid,
        sessionToken: token,
        wsUrl: `${deps.wsBase()}/ws?token=${encodeURIComponent(token)}`,
      };
      return reply.status(201).send(res);
    }
    const actor = loc.actor;
    const state = actor.peek();
    const claims: Parameters<typeof signSessionToken>[0] = {
      sid,
      code,
      role: body.role,
      exp: Date.now() + config.sessionTtlMs,
    };
    if (body.role === "agent") {
      const key = bearer(req);
      if (!key) throw new HttpError(401, "UNAUTHORIZED", "agent sessions need a Bearer api key");
      const agent = await repo.authenticateAgent(key);
      if (!agent) throw new HttpError(401, "UNAUTHORIZED", "invalid api key");
      const isPlayer = Boolean(state.players[agent.id]);
      if (!isPlayer && state.status !== "lobby")
        throw new HttpError(409, "WRONG_PHASE", "match already started");
      if (!isPlayer && state.playerOrder.length >= state.config.maxPlayers) {
        throw new HttpError(409, "ROOM_FULL", "room is full");
      }
      claims.agentId = agent.id;
      claims.humanId = agent.humanId;
    } else if (body.role === "human") {
      if (body.pairCode) {
        const agent = await repo.getAgentByPairCode(body.pairCode.toUpperCase());
        if (!agent) throw new HttpError(401, "UNAUTHORIZED", "unknown pair code");
        claims.agentId = agent.id;
        claims.humanId = agent.humanId;
      } else {
        claims.humanId = await repo.createAnonymousHuman("anonymous");
      }
    }
    await repo.createSession({
      id: sid,
      roomId: actor.roomId,
      role: body.role,
      ...(claims.agentId ? { agentId: claims.agentId } : {}),
      ...(claims.humanId ? { humanId: claims.humanId } : {}),
    });
    const sessionToken = signSessionToken(claims, config.sessionSecret);
    const res: CreateSessionResponse = {
      sessionId: sid,
      sessionToken,
      wsUrl: `${deps.wsBase()}/ws?token=${encodeURIComponent(sessionToken)}`,
    };
    return reply.status(201).send(res);
  });

  app.get<{ Params: { code: string }; Querystring: { after?: string } }>(
    "/rooms/:code/ops",
    async (req, reply) => {
      const actor = await localOrRedirect(req.params.code.toUpperCase(), req, reply);
      if (!actor) return reply;
      const q = parseBody(OpsQuery, req.query);
      const round = actor.peek().game?.round;
      const res: OpsResponse = {
        roundIndex: round ? round.index : null,
        ops: round ? round.ops.filter((e) => e.opSeq > q.after) : [],
      };
      return res;
    },
  );

  app.get<{ Params: { code: string }; Querystring: { token?: string } }>(
    "/rooms/:code/canvas.png",
    {
      config: {
        rateLimit: {
          max: rl.canvasPerSecond,
          timeWindow: "1 second",
          // Per session: the session token (query or bearer); the IP otherwise.
          keyGenerator: (req) => {
            const q = (req.query as { token?: string }).token;
            return `canvas:${q ?? bearer(req) ?? req.ip}`;
          },
        },
      },
    },
    async (req, reply) => {
      // TODO(P5): render the op log to PNG (cached per opSeq). Clients render locally via the SDK.
      const actor = await localOrRedirect(req.params.code.toUpperCase(), req, reply);
      if (!actor) return reply;
      return reply.status(501).send({
        error: { code: "INTERNAL", message: "server-side canvas rendering is not implemented" },
      });
    },
  );

  async function roomIdOf(code: string): Promise<string> {
    const room = await repo.getRoomByCode(code);
    if (!room) throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
    return room.id;
  }

  // --- leaderboard ----------------------------------------------------------

  app.get("/leaderboard", async () => repo.leaderboard());

  // --- admin ----------------------------------------------------------------

  app.post<{ Params: { id: string } }>("/admin/agents/:id/entitlements", async (req) => {
    if (bearer(req) !== config.adminToken)
      throw new HttpError(401, "UNAUTHORIZED", "admin token required");
    const body = parseBody(EntitlementsBody, req.body);
    const res = await repo
      .setEntitlements(req.params.id, body.grant, body.revoke, "admin")
      .catch(() => null);
    if (!res) throw new HttpError(404, "BAD_REQUEST", "agent not found");
    rooms.broadcastEntitlements(res.agentId, res.entitlements as Entitlement[]);
    return res;
  });
}

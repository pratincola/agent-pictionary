import { roomPublic } from "@pictionary/engine";
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
import type { FastifyInstance } from "fastify";
import { newId, signSessionToken } from "../auth.js";
import type { ServerConfig } from "../config.js";
import type { Repo } from "../repo.js";
import type { RoomManager } from "../rooms/manager.js";
import { bearer, HttpError, parseBody, sendError } from "./util.js";

export interface RouteDeps {
  config: ServerConfig;
  repo: Repo;
  rooms: RoomManager;
  /** Resolves the public ws base URL once the server listens. */
  wsBase: () => string;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { repo, rooms, config } = deps;

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

  // --- agents ---------------------------------------------------------------

  app.post("/agents", async (req, reply) => {
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

  app.post("/rooms", async (req, reply) => {
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

  app.get<{ Params: { code: string } }>("/rooms/:code", async (req) => {
    const actor = rooms.get(req.params.code.toUpperCase());
    if (!actor) throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
    return roomPublic(actor.peek());
  });

  app.post<{ Params: { code: string } }>("/rooms/:code/sessions", async (req, reply) => {
    const code = req.params.code.toUpperCase();
    const actor = rooms.get(code);
    if (!actor) throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
    const body = parseBody(CreateSessionBody, req.body);
    const state = actor.peek();
    const sid = newId();
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
    async (req) => {
      const actor = rooms.get(req.params.code.toUpperCase());
      if (!actor) throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
      const q = parseBody(OpsQuery, req.query);
      const round = actor.peek().game?.round;
      const res: OpsResponse = {
        roundIndex: round ? round.index : null,
        ops: round ? round.ops.filter((e) => e.opSeq > q.after) : [],
      };
      return res;
    },
  );

  app.get<{ Params: { code: string } }>("/rooms/:code/canvas.png", async (req, reply) => {
    // TODO(P2/P3): render the op log to PNG (cached per opSeq, 1/s per session).
    const actor = rooms.get(req.params.code.toUpperCase());
    if (!actor) throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
    return reply
      .status(501)
      .send({
        error: { code: "INTERNAL", message: "canvas rendering not implemented in Phase 1" },
      });
  });

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

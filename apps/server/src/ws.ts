/**
 * WebSocket transport. Verifies the session token, hands the connection to
 * the room actor, and turns frames into validated client events. Nothing
 * here mutates room state; everything goes through the actor queue.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { SessionInfo } from "@pictionary/engine";
import {
  ClientEnvelopeLoose,
  ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "@pictionary/protocol";
import type { Logger } from "pino";
import { type WebSocket, WebSocketServer } from "ws";
import { verifySessionToken } from "./auth.js";
import type { ServerConfig } from "./config.js";
import type { Metrics } from "./metrics.js";
import type { Repo } from "./repo.js";
import type { Connection, RoomActor } from "./rooms/actor.js";
import type { RoomManager } from "./rooms/manager.js";
import type { RemoteRoom } from "./rooms/remote.js";

export interface WsDeps {
  config: ServerConfig;
  log: Logger;
  repo: Repo;
  rooms: RoomManager;
  metrics?: Metrics;
}

/** Token bucket: `rate` tokens per second, burst = rate. */
class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private readonly rate: number) {
    this.tokens = rate;
  }
  take(n: number): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens + 1e-9 >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}

export function attachWebSocket(server: Server, deps: WsDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const log = deps.log.child({ component: "ws" });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("token") ?? "";
    const claims = verifySessionToken(token, deps.config.sessionSecret);
    if (!claims) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const actor = deps.rooms.get(claims.code);
    if (actor) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        void onConnection(ws, claims, actor);
      });
      return;
    }
    // Not ours. Spectators may watch through a relay; players must be on the owner.
    void deps.rooms.locate(claims.code).then((loc) => {
      if (loc.kind !== "remote" || claims.role !== "spectator") {
        const status = loc.kind === "remote" ? "409 Conflict" : "404 Not Found";
        socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
        socket.destroy();
        return;
      }
      const relay = deps.rooms.relay(claims.code, loc.node);
      wss.handleUpgrade(req, socket, head, (ws) => {
        onRelayConnection(ws, claims, relay);
      });
    });
  });

  /** Read-only spectator on a node that does not own the room. */
  function onRelayConnection(
    ws: WebSocket,
    claims: NonNullable<ReturnType<typeof verifySessionToken>>,
    relay: RemoteRoom,
  ) {
    const conn: Connection = {
      sessionId: claims.sid,
      info: { sessionId: claims.sid, role: "spectator" },
      send: (json) => {
        if (ws.readyState === ws.OPEN) ws.send(json);
      },
      close: (code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          /* already closed */
        }
      },
    };
    ws.on("message", (data, isBinary) => {
      deps.metrics?.wsMessages.inc({ direction: "in" });
      if (isBinary) return;
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString("utf8"));
      } catch {
        return;
      }
      const loose = ClientEnvelopeLoose.safeParse(raw);
      if (!loose.success) return;
      relay.handle(conn, loose.data.type, loose.data.id);
    });
    ws.on("close", () => {
      relay.detach(conn);
      void deps.repo.markSessionDisconnected(claims.sid).catch(() => {});
    });
    ws.on("error", (err) => log.warn({ err, session: claims.sid }, "socket error"));
    void relay.attach(conn);
    void deps.repo.markSessionConnected(claims.sid).catch(() => {});
  }

  async function onConnection(
    ws: WebSocket,
    claims: NonNullable<ReturnType<typeof verifySessionToken>>,
    actor: RoomActor,
  ) {
    const info: SessionInfo = { sessionId: claims.sid, role: claims.role };
    if (claims.agentId) info.agentId = claims.agentId;
    if (claims.humanId) info.humanId = claims.humanId;
    if (claims.role === "agent" && claims.agentId) {
      // Fresh entitlements and name at connect time.
      try {
        const agent = await deps.repo.getAgent(claims.agentId);
        if (!agent) {
          ws.close(4001, "unknown agent");
          return;
        }
        info.agentName = agent.name;
        info.entitlements = agent.entitlements;
      } catch (err) {
        log.error({ err }, "agent lookup failed");
        ws.close(1011, "internal error");
        return;
      }
    }
    const creator = actor.peek();
    if (
      (info.agentId && creator.creatorAgentId === info.agentId) ||
      (info.humanId && creator.creatorHumanId === info.humanId)
    ) {
      info.creator = true;
    }
    if (ws.readyState !== ws.OPEN) return;

    const conn: Connection = {
      sessionId: claims.sid,
      info,
      send: (json) => {
        if (ws.readyState === ws.OPEN) ws.send(json);
      },
      close: (code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          /* already closed */
        }
      },
    };
    const drawBucket = new TokenBucket(deps.config.drawOpsPerSecond);

    const sendError = (replyTo: string | undefined, code: ErrorCode, message: string) => {
      const err: ServerMessage = {
        type: "error",
        seq: actor.seq,
        ts: Date.now(),
        payload: { code, message },
        ...(replyTo ? { replyTo } : {}),
      };
      conn.send(JSON.stringify(err));
    };

    ws.on("message", (data, isBinary) => {
      // Stamp receipt time before any parsing (PLAN.md §9.2).
      const recvNs = process.hrtime.bigint();
      deps.metrics?.wsMessages.inc({ direction: "in" });
      if (isBinary) {
        sendError(undefined, "BAD_REQUEST", "binary frames are not supported");
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString("utf8"));
      } catch {
        sendError(undefined, "BAD_REQUEST", "malformed JSON");
        return;
      }
      const parsed = ClientMessage.safeParse(raw);
      if (!parsed.success) {
        const loose = ClientEnvelopeLoose.safeParse(raw);
        const replyTo = loose.success ? loose.data.id : undefined;
        const first = parsed.error.issues[0];
        const detail = first ? `${first.path.join(".")}: ${first.message}` : "invalid message";
        sendError(replyTo, "BAD_REQUEST", detail);
        return;
      }
      const msg = parsed.data;
      if (msg.type === "draw.ops" && !drawBucket.take(msg.payload.ops.length)) {
        sendError(
          msg.id,
          "RATE_LIMITED",
          `draw.ops limited to ${deps.config.drawOpsPerSecond} ops/s`,
        );
        return;
      }
      void actor.submit(claims.sid, msg, recvNs);
    });

    ws.on("close", () => {
      actor.detach(conn);
      void deps.repo.markSessionDisconnected(claims.sid).catch(() => {});
    });
    ws.on("error", (err) => log.warn({ err, session: claims.sid }, "socket error"));

    actor.attach(conn);
    void deps.repo.markSessionConnected(claims.sid).catch(() => {});
  }

  return wss;
}

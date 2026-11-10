/**
 * REST helpers (PROTOCOL.md "REST"). `baseUrl` is the server root, e.g.
 * `http://localhost:8080`; the routes live directly under it.
 */
import {
  AgentPublic,
  CreateAgentResponse,
  CreateRoomResponse,
  CreateSessionResponse,
  type Entitlement,
  EntitlementsResponse,
  LeaderboardResponse,
  OpsResponse,
  type PictionaryConfigInput,
  RestError,
  type Role,
  RoomPublic,
} from "@pictionary/protocol";
import type { z } from "zod";
import { ApiError } from "./errors.js";

export interface AgentAuth {
  apiKey: string;
}

export function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function call<T extends z.ZodType>(
  baseUrl: string,
  method: string,
  path: string,
  schema: T,
  opts: { body?: unknown; bearer?: string; expect?: number } = {},
): Promise<z.output<T>> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const res = await fetch(`${stripSlash(baseUrl)}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok || (opts.expect !== undefined && res.status !== opts.expect)) {
    const err = RestError.safeParse(json);
    if (err.success) throw new ApiError(res.status, err.data.error.code, err.data.error.message);
    throw new ApiError(res.status, "UNKNOWN", `${method} ${path} -> ${res.status}`);
  }
  return schema.parse(json);
}

/** `POST /agents`. The apiKey is shown once; store it. */
export function registerAgent(
  baseUrl: string,
  input: { name: string; humanHandle: string },
): Promise<CreateAgentResponse> {
  return call(baseUrl, "POST", "/agents", CreateAgentResponse, { body: input, expect: 201 });
}

/** `GET /agents/:id`. */
export function getAgent(baseUrl: string, agentId: string): Promise<AgentPublic> {
  return call(baseUrl, "GET", `/agents/${encodeURIComponent(agentId)}`, AgentPublic);
}

/** `POST /rooms`. With `auth` the agent becomes the room creator (may `room.start`). */
export function createRoom(
  baseUrl: string,
  auth?: AgentAuth,
  config?: PictionaryConfigInput,
): Promise<CreateRoomResponse> {
  const opts: Parameters<typeof call>[4] = {
    body: { gameId: "pictionary", ...(config ? { config } : {}) },
    expect: 201,
  };
  if (auth) opts.bearer = auth.apiKey;
  return call(baseUrl, "POST", "/rooms", CreateRoomResponse, opts);
}

/** `GET /rooms/:code`. */
export function getRoom(baseUrl: string, code: string): Promise<RoomPublic> {
  return call(baseUrl, "GET", `/rooms/${encodeURIComponent(code)}`, RoomPublic);
}

/** `POST /rooms/:code/sessions`. Agents need `apiKey`; humans may pass `pairCode`. */
export function createSession(
  baseUrl: string,
  code: string,
  role: Role,
  opts: { apiKey?: string; pairCode?: string } = {},
): Promise<CreateSessionResponse> {
  const o: Parameters<typeof call>[4] = {
    body: { role, ...(opts.pairCode ? { pairCode: opts.pairCode } : {}) },
    expect: 201,
  };
  if (opts.apiKey) o.bearer = opts.apiKey;
  return call(
    baseUrl,
    "POST",
    `/rooms/${encodeURIComponent(code)}/sessions`,
    CreateSessionResponse,
    o,
  );
}

/** `GET /rooms/:code/ops?after=`. Gap fill after reconnect. */
export function getOps(baseUrl: string, code: string, after = 0): Promise<OpsResponse> {
  return call(baseUrl, "GET", `/rooms/${encodeURIComponent(code)}/ops?after=${after}`, OpsResponse);
}

/** `GET /leaderboard`. */
export function getLeaderboard(baseUrl: string): Promise<LeaderboardResponse> {
  return call(baseUrl, "GET", "/leaderboard", LeaderboardResponse);
}

/** `POST /admin/agents/:id/entitlements` (admin token; MVP stand-in for payments). */
export function setEntitlements(
  baseUrl: string,
  adminToken: string,
  agentId: string,
  change: { grant?: Entitlement[]; revoke?: Entitlement[] },
): Promise<EntitlementsResponse> {
  return call(
    baseUrl,
    "POST",
    `/admin/agents/${encodeURIComponent(agentId)}/entitlements`,
    EntitlementsResponse,
    { body: change, bearer: adminToken },
  );
}

/** `GET /rooms/:code/canvas.png?opSeq=&size=` as a Buffer (501 on Phase 1 servers). */
export async function getCanvasPng(
  baseUrl: string,
  code: string,
  opts: { opSeq?: number; size?: number; sessionToken?: string } = {},
): Promise<Buffer> {
  const q = new URLSearchParams();
  if (opts.opSeq !== undefined) q.set("opSeq", String(opts.opSeq));
  if (opts.size !== undefined) q.set("size", String(opts.size));
  if (opts.sessionToken) q.set("token", opts.sessionToken);
  const qs = q.size ? `?${q}` : "";
  const res = await fetch(
    `${stripSlash(baseUrl)}/rooms/${encodeURIComponent(code)}/canvas.png${qs}`,
  );
  if (!res.ok) {
    let code: ApiError["code"] = "UNKNOWN";
    let message = `GET canvas.png -> ${res.status}`;
    try {
      const err = RestError.parse(await res.json());
      code = err.error.code;
      message = err.error.message;
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, code, message);
  }
  return Buffer.from(await res.arrayBuffer());
}

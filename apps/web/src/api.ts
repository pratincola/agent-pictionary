import type {
  CreateRoomResponse,
  CreateSessionResponse,
  ErrorPayload,
  OpsResponse,
  Role,
  RoomPublic,
} from "@pictionary/protocol";

/**
 * REST base path. The dev/preview proxy and Caddy forward `/api/v1/*` to the
 * arena server's root. Override with VITE_API_PATH for a different mount.
 */
export const API_PATH: string = import.meta.env.VITE_API_PATH ?? "/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorPayload["code"],
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_PATH}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "INTERNAL", "Cannot reach the server");
  }
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (json as { error?: ErrorPayload } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? "INTERNAL", err?.message ?? res.statusText);
  }
  return json as T;
}

export function createRoom(): Promise<CreateRoomResponse> {
  return call("POST", "/rooms", { gameId: "pictionary" });
}

export function getRoom(code: string): Promise<RoomPublic> {
  return call("GET", `/rooms/${encodeURIComponent(code)}`);
}

export function createSession(
  code: string,
  role: Exclude<Role, "agent">,
  pairCode?: string,
): Promise<CreateSessionResponse> {
  return call("POST", `/rooms/${encodeURIComponent(code)}/sessions`, {
    role,
    ...(pairCode ? { pairCode } : {}),
  });
}

export function getOps(code: string, after: number): Promise<OpsResponse> {
  return call("GET", `/rooms/${encodeURIComponent(code)}/ops?after=${after}`);
}

/**
 * WebSocket URL for a session. The server's `wsUrl` points at its own
 * listen address; behind the dev proxy or Caddy the browser must use its own
 * origin instead, so we rebuild the URL from the token. VITE_WS_BASE
 * (e.g. wss://arena.example.com) overrides the origin.
 */
export function wsUrlFor(session: CreateSessionResponse, loc: Location = window.location): string {
  const base: string | undefined = import.meta.env.VITE_WS_BASE;
  const token = tokenFromWsUrl(session.wsUrl) ?? session.sessionToken;
  if (base) return `${base.replace(/\/$/, "")}/ws?token=${encodeURIComponent(token)}`;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws?token=${encodeURIComponent(token)}`;
}

function tokenFromWsUrl(wsUrl: string): string | undefined {
  try {
    return new URL(wsUrl).searchParams.get("token") ?? undefined;
  } catch {
    return undefined;
  }
}

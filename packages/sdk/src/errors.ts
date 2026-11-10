import type { Entitlement, ErrorCode } from "@pictionary/protocol";

/** REST call failed (non-2xx). `code` is the protocol error code when the body had one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "UNKNOWN",
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The server answered a WebSocket request with `error`. */
export class ProtocolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly entitlement?: Entitlement,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

/** `waitFor` or a request did not get an answer in time. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/** The socket closed while a request was pending and no reconnect will follow. */
export class DisconnectedError extends Error {
  constructor(
    readonly closeCode: number,
    readonly reason: string,
  ) {
    super(`disconnected (${closeCode}${reason ? ` ${reason}` : ""})`);
    this.name = "DisconnectedError";
  }
}

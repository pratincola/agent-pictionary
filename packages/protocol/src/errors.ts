import { z } from "zod";

/** Error codes from PROTOCOL.md. Shared by REST and WebSocket errors. */
export const ErrorCode = z.enum([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "NOT_IN_ROOM",
  "WRONG_PHASE",
  "NOT_DRAWER",
  "NOT_GUESSER",
  "NO_GUESSES_LEFT",
  "ENTITLEMENT_REQUIRED",
  "RATE_LIMITED",
  "ROOM_FULL",
  "ROOM_NOT_FOUND",
  "INVALID_WORD",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const Entitlement = z.enum(["custom_word", "erase"]);
export type Entitlement = z.infer<typeof Entitlement>;

export const ErrorPayload = z.object({
  code: ErrorCode,
  message: z.string(),
  entitlement: Entitlement.optional(),
});
export type ErrorPayload = z.infer<typeof ErrorPayload>;

/** REST error body. */
export const RestError = z.object({ error: ErrorPayload });
export type RestError = z.infer<typeof RestError>;

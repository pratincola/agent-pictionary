import type { ErrorCode } from "@pictionary/protocol";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(
      400,
      "BAD_REQUEST",
      first ? `${first.path.join(".")}: ${first.message}` : "invalid body",
    );
  }
  return r.data;
}

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim();
}

export function sendError(reply: FastifyReply, err: HttpError) {
  return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
}

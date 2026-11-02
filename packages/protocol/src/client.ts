import { z } from "zod";
import { PROTOCOL_VERSION } from "./common.js";
import { DrawOp, MAX_OPS_PER_MESSAGE } from "./draw.js";

/** Fields every client -> server envelope carries. */
const envelope = {
  /** Client UUID; idempotency key. Same id => same reply, no new effect. */
  id: z.string().min(1).max(64),
  /** Client wall clock in ms. Informational only, never used for ordering. */
  ts: z.number().int().nonnegative(),
  /** Protocol major version. Required on `hello`, optional elsewhere. */
  v: z.literal(PROTOCOL_VERSION).optional(),
};

export const HelloPayload = z.object({}).strict();
export const EmptyPayload = z.object({}).strict();
export const WordChoosePayload = z.object({ index: z.number().int().min(0).max(2) });
export const WordCustomPayload = z.object({ word: z.string().min(1).max(64) });
export const TextPayload = z.object({ text: z.string().min(1).max(200) });
export const DrawOpsPayload = z.object({ ops: z.array(DrawOp).min(1).max(MAX_OPS_PER_MESSAGE) });
export const DrawErasePayload = z.object({ opSeq: z.number().int().positive() });

export const HelloMessage = z.object({
  type: z.literal("hello"),
  ...envelope,
  v: z.literal(PROTOCOL_VERSION),
  payload: HelloPayload.default({}),
});
export const RoomReadyMessage = z.object({
  type: z.literal("room.ready"),
  ...envelope,
  payload: EmptyPayload.default({}),
});
export const RoomStartMessage = z.object({
  type: z.literal("room.start"),
  ...envelope,
  payload: EmptyPayload.default({}),
});
export const WordChooseMessage = z.object({
  type: z.literal("word.choose"),
  ...envelope,
  payload: WordChoosePayload,
});
export const WordCustomMessage = z.object({
  type: z.literal("word.custom"),
  ...envelope,
  payload: WordCustomPayload,
});
export const HumanNoteMessage = z.object({
  type: z.literal("human.note"),
  ...envelope,
  payload: TextPayload,
});
export const DrawOpsMessage = z.object({
  type: z.literal("draw.ops"),
  ...envelope,
  payload: DrawOpsPayload,
});
export const DrawEraseMessage = z.object({
  type: z.literal("draw.erase"),
  ...envelope,
  payload: DrawErasePayload,
});
export const DrawClearMessage = z.object({
  type: z.literal("draw.clear"),
  ...envelope,
  payload: EmptyPayload.default({}),
});
export const GuessSubmitMessage = z.object({
  type: z.literal("guess.submit"),
  ...envelope,
  payload: TextPayload,
});
export const HumanGuessMessage = z.object({
  type: z.literal("human.guess"),
  ...envelope,
  payload: TextPayload,
});
export const PingMessage = z.object({
  type: z.literal("ping"),
  ...envelope,
  payload: EmptyPayload.default({}),
});

export const ClientMessage = z.discriminatedUnion("type", [
  HelloMessage,
  RoomReadyMessage,
  RoomStartMessage,
  WordChooseMessage,
  WordCustomMessage,
  HumanNoteMessage,
  DrawOpsMessage,
  DrawEraseMessage,
  DrawClearMessage,
  GuessSubmitMessage,
  HumanGuessMessage,
  PingMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageType = ClientMessage["type"];
export type ClientMessageOf<T extends ClientMessageType> = Extract<ClientMessage, { type: T }>;

/** Loose envelope used to extract `id`/`type` from an otherwise invalid message. */
export const ClientEnvelopeLoose = z.object({
  type: z.string().optional(),
  id: z.string().optional(),
});

export type { RenderOptions } from "@pictionary/render";
export { renderDataUrl, renderPng } from "@pictionary/render";
export type {
  AgentClientOptions,
  EventName,
  GuessResult,
  Handler,
  LifecycleEvents,
  ReconnectOptions,
} from "./client.js";
export { AgentClient } from "./client.js";
export { ApiError, DisconnectedError, ProtocolError, TimeoutError } from "./errors.js";
export type { AckRange, DrawQueueOptions, DrawResult, PacerOptions } from "./pacer.js";
export { DrawQueue, Pacer } from "./pacer.js";
export type { AgentAuth } from "./rest.js";
export {
  createRoom,
  createSession,
  getAgent,
  getCanvasPng,
  getLeaderboard,
  getOps,
  getRoom,
  registerAgent,
  setEntitlements,
} from "./rest.js";
export type { AgentState, RoundEndedPayload } from "./state.js";
export {
  fromSnapshot,
  lastOpSeq,
  reduce,
  secondsLeft,
  setChosenWord,
  visibleOpLog,
} from "./state.js";

import { z } from "zod";
import {
  GameId,
  Id,
  PictionaryConfig,
  PlayerInfo,
  Role,
  RoomCode,
  RoomStatus,
  Tier,
} from "./common.js";
import { OpLogEntry } from "./draw.js";
import { Entitlement } from "./errors.js";

export const AgentName = z.string().trim().min(1).max(40);
export const HumanHandle = z.string().trim().min(1).max(40);

// POST /agents
export const CreateAgentBody = z.object({ name: AgentName, humanHandle: HumanHandle });
export type CreateAgentBody = z.infer<typeof CreateAgentBody>;
export const CreateAgentResponse = z.object({
  agentId: Id,
  humanId: Id,
  apiKey: z.string(),
  humanPairCode: z.string(),
});
export type CreateAgentResponse = z.infer<typeof CreateAgentResponse>;

// GET /agents/:id
export const AgentStats = z.object({
  matches: z.number().int().nonnegative(),
  roundsDrawn: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  points: z.number().int(),
});
export type AgentStats = z.infer<typeof AgentStats>;
export const AgentPublic = z.object({
  id: Id,
  name: z.string(),
  tier: Tier,
  entitlements: z.array(Entitlement),
  stats: AgentStats,
});
export type AgentPublic = z.infer<typeof AgentPublic>;

// POST /rooms
export const CreateRoomBody = z.object({
  gameId: GameId.default("pictionary"),
  config: PictionaryConfig.partial().optional(),
});
export type CreateRoomBody = z.input<typeof CreateRoomBody>;
export const CreateRoomResponse = z.object({ code: RoomCode, roomId: Id });
export type CreateRoomResponse = z.infer<typeof CreateRoomResponse>;

// GET /rooms/:code
export const RoomPublic = z.object({
  code: RoomCode,
  gameId: GameId,
  status: RoomStatus,
  players: z.array(PlayerInfo),
  config: PictionaryConfig,
});
export type RoomPublic = z.infer<typeof RoomPublic>;

// POST /rooms/:code/sessions
export const CreateSessionBody = z.object({
  role: Role,
  /** Human role: pairs this human to the agent that owns the pair code. */
  pairCode: z.string().optional(),
});
export type CreateSessionBody = z.infer<typeof CreateSessionBody>;
export const CreateSessionResponse = z.object({
  sessionId: Id,
  sessionToken: z.string(),
  wsUrl: z.string(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

// GET /rooms/:code/ops?after=
export const OpsQuery = z.object({ after: z.coerce.number().int().nonnegative().default(0) });
export const OpsResponse = z.object({
  roundIndex: z.number().int().nonnegative().nullable(),
  ops: z.array(OpLogEntry),
});
export type OpsResponse = z.infer<typeof OpsResponse>;

// GET /leaderboard
export const LeaderboardEntry = z.object({
  agentId: Id,
  name: z.string(),
  matches: z.number().int().nonnegative(),
  roundsDrawn: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  points: z.number().int(),
});
export const LeaderboardResponse = z.object({ agents: z.array(LeaderboardEntry) });
export type LeaderboardResponse = z.infer<typeof LeaderboardResponse>;

// POST /admin/agents/:id/entitlements
export const EntitlementsBody = z.object({
  grant: z.array(Entitlement).default([]),
  revoke: z.array(Entitlement).default([]),
});
export type EntitlementsBody = z.input<typeof EntitlementsBody>;
export const EntitlementsResponse = z.object({
  agentId: Id,
  entitlements: z.array(Entitlement),
  tier: Tier,
});
export type EntitlementsResponse = z.infer<typeof EntitlementsResponse>;

// GET /healthz
export const HealthResponse = z.object({ ok: z.literal(true) });

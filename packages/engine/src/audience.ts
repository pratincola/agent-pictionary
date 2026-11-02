import {
  AGENT_FORBIDDEN_MESSAGE_TYPES,
  type Role,
  type ServerMessageBody,
} from "@pictionary/protocol";
import type { Audience, SessionTarget } from "./types.js";

/** Does a session with this role belong to the audience? */
export function inAudience(audience: Audience, role: Role): boolean {
  switch (audience) {
    case "all":
      return true;
    case "agents":
      return role === "agent";
    case "humans":
      return role === "human";
    case "spectators":
      return role === "spectator";
    case "non_agents":
      return role !== "agent";
  }
}

/**
 * Last line of defence for PLAN.md §11: a message that must never reach an
 * agent is dropped here even if an audience was computed wrongly upstream.
 */
export function allowedForRole(message: ServerMessageBody, role: Role): boolean {
  if (role === "agent" && AGENT_FORBIDDEN_MESSAGE_TYPES.has(message.type)) return false;
  return true;
}

export function describeTarget(t: SessionTarget): string {
  if ("sessionId" in t) return `session:${t.sessionId}`;
  if ("agentId" in t) return `agent:${t.agentId}`;
  return `humansOf:${t.humansOfAgent}`;
}

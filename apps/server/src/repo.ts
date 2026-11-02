/** Thin data-access layer. Every DB statement the server runs lives here or in persistence.ts. */
import type { AgentStats, Entitlement, LeaderboardResponse, Tier } from "@pictionary/protocol";
import { Entitlement as EntitlementSchema } from "@pictionary/protocol";
import { desc, eq, sql } from "drizzle-orm";
import { generateApiKey, generatePairCode, newId, splitApiKey, verifySecret } from "./auth.js";
import { type Db, schema } from "./db/index.js";

export interface AgentRow {
  id: string;
  humanId: string;
  name: string;
  tier: Tier;
  entitlements: Entitlement[];
  pairCode: string;
  apiKeyHash: string;
}

function toAgentRow(r: typeof schema.agents.$inferSelect): AgentRow {
  return {
    id: r.id,
    humanId: r.humanId,
    name: r.name,
    tier: r.tier === "paid" ? "paid" : "free",
    entitlements: r.entitlements.filter(
      (e): e is Entitlement => EntitlementSchema.safeParse(e).success,
    ),
    pairCode: r.pairCode,
    apiKeyHash: r.apiKeyHash,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class Repo {
  constructor(private readonly db: Db) {}

  async createAgent(name: string, humanHandle: string) {
    const humanId = newId();
    const agentId = newId();
    const { apiKey, hash } = generateApiKey(agentId);
    const pairCode = generatePairCode();
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.humans).values({ id: humanId, handle: humanHandle });
      await tx
        .insert(schema.agents)
        .values({ id: agentId, humanId, name, apiKeyHash: hash, pairCode });
      await tx.insert(schema.agentStats).values({ agentId });
    });
    return { agentId, humanId, apiKey, humanPairCode: pairCode };
  }

  async getAgent(id: string): Promise<AgentRow | null> {
    if (!UUID_RE.test(id)) return null;
    const rows = await this.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, id))
      .limit(1);
    const r = rows[0];
    return r ? toAgentRow(r) : null;
  }

  async getAgentByPairCode(code: string): Promise<AgentRow | null> {
    const rows = await this.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.pairCode, code))
      .limit(1);
    const r = rows[0];
    return r ? toAgentRow(r) : null;
  }

  /** Verifies "<agentId>.<secret>" against the stored scrypt hash. */
  async authenticateAgent(apiKey: string): Promise<AgentRow | null> {
    const parts = splitApiKey(apiKey);
    if (!parts) return null;
    const agent = await this.getAgent(parts.agentId);
    if (!agent) return null;
    if (!verifySecret(parts.secret, agent.apiKeyHash)) return null;
    void this.db
      .update(schema.agents)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.agents.id, agent.id))
      .catch(() => {});
    return agent;
  }

  async getAgentStats(agentId: string): Promise<AgentStats> {
    const rows = await this.db
      .select()
      .from(schema.agentStats)
      .where(eq(schema.agentStats.agentId, agentId))
      .limit(1);
    const r = rows[0];
    return r
      ? { matches: r.matches, roundsDrawn: r.roundsDrawn, wins: r.wins, points: r.points }
      : { matches: 0, roundsDrawn: 0, wins: 0, points: 0 };
  }

  async setEntitlements(
    agentId: string,
    grant: Entitlement[],
    revoke: Entitlement[],
    source: string,
  ) {
    const agent = await this.getAgent(agentId);
    if (!agent) return null;
    const set = new Set(agent.entitlements);
    for (const e of grant) set.add(e);
    for (const e of revoke) set.delete(e);
    const entitlements = [...set].sort();
    const tier: Tier = entitlements.length > 0 ? "paid" : "free";
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.agents)
        .set({ entitlements, tier })
        .where(eq(schema.agents.id, agentId));
      if (grant.length > 0) {
        await tx
          .insert(schema.entitlementGrants)
          .values(grant.map((e) => ({ agentId, entitlement: e, source })));
      }
    });
    return { agentId, entitlements, tier };
  }

  async createRoom(row: {
    id: string;
    code: string;
    gameId: string;
    config: unknown;
    seed: number;
    creatorAgentId?: string;
    creatorHumanId?: string;
  }) {
    await this.db.insert(schema.rooms).values({
      id: row.id,
      code: row.code,
      gameId: row.gameId,
      config: row.config,
      seed: row.seed,
      creatorAgentId: row.creatorAgentId ?? null,
      creatorHumanId: row.creatorHumanId ?? null,
    });
  }

  async setRoomStatus(roomId: string, status: string) {
    await this.db
      .update(schema.rooms)
      .set({ status, ...(status === "finished" ? { closedAt: new Date() } : {}) })
      .where(eq(schema.rooms.id, roomId));
  }

  async createSession(row: {
    id: string;
    roomId: string;
    role: string;
    agentId?: string;
    humanId?: string;
  }) {
    await this.db.insert(schema.sessions).values({
      id: row.id,
      roomId: row.roomId,
      role: row.role,
      agentId: row.agentId ?? null,
      humanId: row.humanId ?? null,
    });
  }

  async createAnonymousHuman(handle: string): Promise<string> {
    const id = newId();
    await this.db.insert(schema.humans).values({ id, handle });
    return id;
  }

  async markSessionConnected(sessionId: string) {
    await this.db
      .update(schema.sessions)
      .set({
        connectedAt: new Date(),
        disconnectedAt: null,
        reconnects: sql`CASE WHEN ${schema.sessions.connectedAt} IS NULL THEN 0 ELSE ${schema.sessions.reconnects} + 1 END`,
      })
      .where(eq(schema.sessions.id, sessionId));
  }

  async markSessionDisconnected(sessionId: string) {
    await this.db
      .update(schema.sessions)
      .set({ disconnectedAt: new Date() })
      .where(eq(schema.sessions.id, sessionId));
  }

  async leaderboard(limit = 50): Promise<LeaderboardResponse> {
    const rows = await this.db
      .select({
        agentId: schema.agentStats.agentId,
        name: schema.agents.name,
        matches: schema.agentStats.matches,
        roundsDrawn: schema.agentStats.roundsDrawn,
        wins: schema.agentStats.wins,
        points: schema.agentStats.points,
      })
      .from(schema.agentStats)
      .innerJoin(schema.agents, eq(schema.agents.id, schema.agentStats.agentId))
      .orderBy(desc(schema.agentStats.points), desc(schema.agentStats.wins), schema.agents.name)
      .limit(limit);
    return { agents: rows };
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }
}

import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const humans = pgTable("humans", {
  id: uuid("id").primaryKey(),
  handle: text("handle").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey(),
    humanId: uuid("human_id")
      .notNull()
      .references(() => humans.id),
    name: text("name").notNull(),
    apiKeyHash: text("api_key_hash").notNull(),
    tier: text("tier").notNull().default("free"),
    entitlements: text("entitlements").array().notNull().default([]),
    pairCode: text("pair_code").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at"),
  },
  (t) => [uniqueIndex("agents_pair_code_idx").on(t.pairCode)],
);

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey(),
  code: text("code").notNull().unique(),
  gameId: text("game_id").notNull(),
  config: jsonb("config").notNull(),
  status: text("status").notNull().default("lobby"),
  seed: integer("seed").notNull(),
  creatorAgentId: uuid("creator_agent_id").references(() => agents.id),
  creatorHumanId: uuid("creator_human_id").references(() => humans.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  closedAt: ts("closed_at"),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    agentId: uuid("agent_id").references(() => agents.id),
    humanId: uuid("human_id").references(() => humans.id),
    role: text("role").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    connectedAt: ts("connected_at"),
    disconnectedAt: ts("disconnected_at"),
    reconnects: integer("reconnects").notNull().default(0),
  },
  (t) => [index("sessions_room_idx").on(t.roomId)],
);

export const matches = pgTable("matches", {
  id: text("id").primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id),
  startedAt: ts("started_at").notNull(),
  endedAt: ts("ended_at"),
});

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id),
    index: integer("index").notNull(),
    drawerAgentId: uuid("drawer_agent_id")
      .notNull()
      .references(() => agents.id),
    word: text("word").notNull(),
    wordSource: text("word_source").notNull(),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at").notNull(),
    reason: text("reason").notNull(),
    winnerAgentId: uuid("winner_agent_id").references(() => agents.id),
    winnerSource: text("winner_source"),
    winningSeq: integer("winning_seq"),
    winningRecvNs: bigint("winning_recv_ns", { mode: "bigint" }),
  },
  (t) => [uniqueIndex("rounds_match_index_idx").on(t.matchId, t.index)],
);

export const guesses = pgTable(
  "guesses",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    seq: integer("seq").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    humanId: uuid("human_id").references(() => humans.id),
    source: text("source").notNull(),
    text: text("text").notNull(),
    normalized: text("normalized").notNull(),
    result: text("result").notNull(),
    recvNs: bigint("recv_ns", { mode: "bigint" }),
    clientTs: bigint("client_ts", { mode: "number" }).notNull(),
  },
  (t) => [
    index("guesses_round_idx").on(t.roundId),
    uniqueIndex("guesses_round_seq_idx").on(t.roundId, t.seq),
  ],
);

export const drawOps = pgTable(
  "draw_ops",
  {
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    opSeq: integer("op_seq").notNull(),
    op: jsonb("op").notNull(),
    erased: boolean("erased").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.roundId, t.opSeq] })],
);

export const scores = pgTable(
  "scores",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    points: integer("points").notNull().default(0),
    agentPoints: integer("agent_points").notNull().default(0),
    humanPoints: integer("human_points").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.agentId] })],
);

export const agentStats = pgTable("agent_stats", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agents.id),
  matches: integer("matches").notNull().default(0),
  roundsDrawn: integer("rounds_drawn").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  points: integer("points").notNull().default(0),
});

export const outbox = pgTable("outbox", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

export const entitlementGrants = pgTable("entitlement_grants", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id),
  entitlement: text("entitlement").notNull(),
  source: text("source").notNull(),
  grantedAt: ts("granted_at").notNull().defaultNow(),
  expiresAt: ts("expires_at"),
});

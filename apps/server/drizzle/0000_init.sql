CREATE TABLE "agent_stats" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"matches" integer DEFAULT 0 NOT NULL,
	"rounds_drawn" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"human_id" uuid NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"entitlements" text[] DEFAULT '{}' NOT NULL,
	"pair_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "draw_ops" (
	"round_id" uuid NOT NULL,
	"op_seq" integer NOT NULL,
	"op" jsonb NOT NULL,
	"erased" boolean DEFAULT false NOT NULL,
	CONSTRAINT "draw_ops_round_id_op_seq_pk" PRIMARY KEY("round_id","op_seq")
);
--> statement-breakpoint
CREATE TABLE "entitlement_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"entitlement" text NOT NULL,
	"source" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guesses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"agent_id" uuid NOT NULL,
	"human_id" uuid,
	"source" text NOT NULL,
	"text" text NOT NULL,
	"normalized" text NOT NULL,
	"result" text NOT NULL,
	"recv_ns" bigint,
	"client_ts" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "humans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"game_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"seed" integer NOT NULL,
	"creator_agent_id" uuid,
	"creator_human_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "rooms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"index" integer NOT NULL,
	"drawer_agent_id" uuid NOT NULL,
	"word" text NOT NULL,
	"word_source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"winner_agent_id" uuid,
	"winner_source" text,
	"winning_seq" integer,
	"winning_recv_ns" bigint
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"match_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"agent_points" integer DEFAULT 0 NOT NULL,
	"human_points" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "scores_match_id_agent_id_pk" PRIMARY KEY("match_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"agent_id" uuid,
	"human_id" uuid,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"reconnects" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_stats" ADD CONSTRAINT "agent_stats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_human_id_humans_id_fk" FOREIGN KEY ("human_id") REFERENCES "public"."humans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_ops" ADD CONSTRAINT "draw_ops_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_human_id_humans_id_fk" FOREIGN KEY ("human_id") REFERENCES "public"."humans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_creator_human_id_humans_id_fk" FOREIGN KEY ("creator_human_id") REFERENCES "public"."humans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_drawer_agent_id_agents_id_fk" FOREIGN KEY ("drawer_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_winner_agent_id_agents_id_fk" FOREIGN KEY ("winner_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_human_id_humans_id_fk" FOREIGN KEY ("human_id") REFERENCES "public"."humans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_pair_code_idx" ON "agents" USING btree ("pair_code");--> statement-breakpoint
CREATE INDEX "guesses_round_idx" ON "guesses" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guesses_round_seq_idx" ON "guesses" USING btree ("round_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_match_index_idx" ON "rounds" USING btree ("match_id","index");--> statement-breakpoint
CREATE INDEX "sessions_room_idx" ON "sessions" USING btree ("room_id");
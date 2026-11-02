/**
 * Maps engine `persist` effects to Postgres rows. Writes happen inside the
 * room actor's step, before the matching broadcast (PLAN.md §9.5). A failed
 * write goes to the `outbox` table (or an in-memory queue when even that
 * fails) and is retried in order.
 */
import type { PersistRecord } from "@pictionary/engine";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { newId } from "../auth.js";
import { type Db, schema } from "../db/index.js";

export interface PersistContext {
  roomId: string;
}

type Envelope = { ctx: PersistContext; record: PersistRecord };

export class Persistence {
  private pending: Envelope[] = [];
  private timer: NodeJS.Timeout | undefined;
  private retrying = false;
  /** Test hook: when set, applyRecord throws for matching records. */
  failInjector: ((record: PersistRecord) => boolean) | undefined;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly retryMs = 5_000,
  ) {}

  start() {
    if (!this.timer) {
      this.timer = setInterval(() => void this.retry(), this.retryMs);
      this.timer.unref();
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.retry();
  }

  /** Write now; on failure, park in the outbox. Never throws. */
  async write(
    ctx: PersistContext,
    record: PersistRecord,
  ): Promise<"written" | "outboxed" | "queued"> {
    try {
      await this.apply(ctx, record);
      return "written";
    } catch (err) {
      this.log.error({ err, type: record.type }, "persist failed; writing to outbox");
      try {
        await this.db.insert(schema.outbox).values({
          kind: record.type,
          payload: { ctx, record },
          attempts: 1,
          lastError: String(err),
        });
        return "outboxed";
      } catch (err2) {
        this.log.error({ err: err2 }, "outbox insert failed; keeping in memory");
        this.pending.push({ ctx, record });
        return "queued";
      }
    }
  }

  /** Retry in-memory items, then outbox rows, in order. Stops at the first failure. */
  async retry(): Promise<void> {
    if (this.retrying) return;
    this.retrying = true;
    try {
      while (this.pending.length > 0) {
        const item = this.pending[0] as Envelope;
        try {
          await this.apply(item.ctx, item.record);
          this.pending.shift();
        } catch (err) {
          try {
            await this.db.insert(schema.outbox).values({
              kind: item.record.type,
              payload: item,
              attempts: 1,
              lastError: String(err),
            });
            this.pending.shift();
          } catch {
            return;
          }
        }
      }
      const rows = await this.db
        .select()
        .from(schema.outbox)
        .where(isNull(schema.outbox.sentAt))
        .orderBy(asc(schema.outbox.id))
        .limit(100);
      for (const row of rows) {
        const item = row.payload as Envelope;
        try {
          await this.apply(item.ctx, item.record);
          await this.db
            .update(schema.outbox)
            .set({ sentAt: new Date() })
            .where(eq(schema.outbox.id, row.id));
        } catch (err) {
          await this.db
            .update(schema.outbox)
            .set({ attempts: row.attempts + 1, lastError: String(err) })
            .where(eq(schema.outbox.id, row.id));
          return;
        }
      }
    } catch (err) {
      this.log.warn({ err }, "outbox retry failed");
    } finally {
      this.retrying = false;
    }
  }

  private async apply(ctx: PersistContext, record: PersistRecord): Promise<void> {
    if (this.failInjector?.(record)) throw new Error("injected persistence failure");
    switch (record.type) {
      case "match.started":
        await this.db
          .insert(schema.matches)
          .values({ id: record.matchId, roomId: ctx.roomId, startedAt: new Date(record.startedAt) })
          .onConflictDoNothing();
        await this.db
          .update(schema.rooms)
          .set({ status: "playing" })
          .where(eq(schema.rooms.id, ctx.roomId));
        return;
      case "round.ended":
        await this.db.transaction(async (tx) => {
          const existing = await tx
            .select({ id: schema.rounds.id })
            .from(schema.rounds)
            .where(
              and(
                eq(schema.rounds.matchId, record.matchId),
                eq(schema.rounds.index, record.roundIndex),
              ),
            )
            .limit(1);
          if (existing.length > 0) return; // idempotent retry
          const roundId = newId();
          await tx.insert(schema.rounds).values({
            id: roundId,
            matchId: record.matchId,
            index: record.roundIndex,
            drawerAgentId: record.drawerAgentId,
            word: record.word,
            wordSource: record.wordSource,
            startedAt: new Date(record.startedAt),
            endedAt: new Date(record.endedAt),
            reason: record.reason,
            winnerAgentId: record.winner?.agentId ?? null,
            winnerSource: record.winner?.source ?? null,
            winningSeq: record.winner?.seq ?? null,
            winningRecvNs: record.winner?.recvNs ? BigInt(record.winner.recvNs) : null,
          });
          for (let i = 0; i < record.guesses.length; i += 500) {
            const chunk = record.guesses.slice(i, i + 500);
            await tx.insert(schema.guesses).values(
              chunk.map((g) => ({
                roundId,
                seq: g.seq,
                agentId: g.agentId,
                humanId: g.humanId ?? null,
                source: g.source,
                text: g.text,
                normalized: g.normalized,
                result: g.result,
                recvNs: g.recvNs ? BigInt(g.recvNs) : null,
                clientTs: g.clientTs,
              })),
            );
          }
          for (let i = 0; i < record.ops.length; i += 500) {
            const chunk = record.ops.slice(i, i + 500);
            await tx
              .insert(schema.drawOps)
              .values(
                chunk.map((e) => ({
                  roundId,
                  opSeq: e.opSeq,
                  op: e.op,
                  erased: e.erased ?? false,
                })),
              );
          }
          for (const [agentId, s] of Object.entries(record.scores)) {
            await tx
              .insert(schema.scores)
              .values({
                matchId: record.matchId,
                agentId,
                points: s.points,
                agentPoints: s.agentPoints,
                humanPoints: s.humanPoints,
              })
              .onConflictDoUpdate({
                target: [schema.scores.matchId, schema.scores.agentId],
                set: { points: s.points, agentPoints: s.agentPoints, humanPoints: s.humanPoints },
              });
          }
        });
        return;
      case "match.ended":
        await this.db.transaction(async (tx) => {
          const updated = await tx
            .update(schema.matches)
            .set({ endedAt: new Date(record.endedAt) })
            .where(and(eq(schema.matches.id, record.matchId), isNull(schema.matches.endedAt)))
            .returning({ id: schema.matches.id });
          if (updated.length === 0) return; // already applied
          for (const agentId of Object.keys(record.scores)) {
            const s = record.scores[agentId] ?? { points: 0, agentPoints: 0, humanPoints: 0 };
            const drawn = record.roundsDrawn[agentId] ?? 0;
            const won = record.roundsWon[agentId] ?? 0;
            await tx
              .insert(schema.agentStats)
              .values({ agentId, matches: 1, roundsDrawn: drawn, wins: won, points: s.points })
              .onConflictDoUpdate({
                target: schema.agentStats.agentId,
                set: {
                  matches: sql`${schema.agentStats.matches} + 1`,
                  roundsDrawn: sql`${schema.agentStats.roundsDrawn} + ${drawn}`,
                  wins: sql`${schema.agentStats.wins} + ${won}`,
                  points: sql`${schema.agentStats.points} + ${s.points}`,
                },
              });
          }
          await tx
            .update(schema.rooms)
            .set({ status: "finished", closedAt: new Date(record.endedAt) })
            .where(eq(schema.rooms.id, ctx.roomId));
        });
        return;
    }
  }
}

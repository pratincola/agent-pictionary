/**
 * Redis-backed room directory, event bus and snapshot store (PLAN.md §9.6,
 * §12). Keys:
 *
 *   room:{code}            -> nodeId        SET NX PX ttl; renewed by heartbeat
 *   room:{code}:snapshot   -> RoomSnapshot  JSON, 24 h TTL
 *   node:{id}              -> hash          restBase, wsBase; PX ttl
 *   node:{id}:rooms        -> set of codes  what to restore after a restart
 *   room:{code}:events     pub/sub          spectator-visible broadcasts
 *   room:{code}:control    pub/sub          {"type":"room.closed"}
 */
import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { EventBus, NodeInfo, RoomDirectory, RoomSnapshot, SnapshotStore } from "./infra.js";

const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Renew our entry, or re-create it when it expired (Redis blip, paused
 * process) and nobody else claimed the code meanwhile.
 */
const RENEW_OR_RECLAIM = `
local cur = redis.call('GET', KEYS[1])
if cur == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
elseif not cur then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 2
end
return 0`;

/** DEL only if the key still holds our nodeId. */
const DEL_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

export function createRedis(url: string, log: Logger, name: string): Redis {
  const r = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    connectionName: name,
  });
  r.on("error", (err) => log.warn({ err, redis: name }, "redis error"));
  return r;
}

export class RedisRoomDirectory implements RoomDirectory {
  constructor(
    private readonly redis: Redis,
    private readonly ttlMs: number,
  ) {}

  async claim(code: string, nodeId: string): Promise<boolean> {
    const res = await this.redis.set(`room:${code}`, nodeId, "PX", this.ttlMs, "NX");
    if (res !== "OK") return false;
    await this.redis.sadd(`node:${nodeId}:rooms`, code);
    return true;
  }

  async lookup(code: string): Promise<string | null> {
    return this.redis.get(`room:${code}`);
  }

  async release(code: string, nodeId: string): Promise<void> {
    await this.redis.eval(DEL_IF_OWNER, 1, `room:${code}`, nodeId);
    await this.redis.srem(`node:${nodeId}:rooms`, code);
  }

  async unpin(code: string, nodeId: string): Promise<void> {
    await this.redis.eval(DEL_IF_OWNER, 1, `room:${code}`, nodeId);
  }

  async heartbeat(nodeId: string, codes: readonly string[]): Promise<void> {
    const p = this.redis.pipeline();
    p.pexpire(`node:${nodeId}`, this.ttlMs);
    for (const code of codes) p.eval(RENEW_OR_RECLAIM, 1, `room:${code}`, nodeId, this.ttlMs);
    await p.exec();
  }

  async registerNode(info: NodeInfo): Promise<void> {
    const key = `node:${info.nodeId}`;
    await this.redis
      .multi()
      .hset(key, { restBase: info.restBase, wsBase: info.wsBase })
      .pexpire(key, this.ttlMs)
      .exec();
  }

  async unregisterNode(nodeId: string): Promise<void> {
    await this.redis.del(`node:${nodeId}`);
  }

  async getNode(nodeId: string): Promise<NodeInfo | null> {
    const h = await this.redis.hgetall(`node:${nodeId}`);
    if (!h.restBase || !h.wsBase) return null;
    return { nodeId, restBase: h.restBase, wsBase: h.wsBase };
  }

  async ownedRooms(nodeId: string): Promise<string[]> {
    return this.redis.smembers(`node:${nodeId}:rooms`);
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => {});
  }
}

export class RedisEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<(json: string) => void>>();
  private readonly sub: Redis;

  constructor(
    private readonly pub: Redis,
    url: string,
    log: Logger,
  ) {
    this.sub = createRedis(url, log, "ap-sub");
    this.sub.on("message", (channel: string, message: string) => {
      const hs = this.handlers.get(channel);
      if (!hs) return;
      for (const h of hs) h(message);
    });
  }

  async publish(channel: string, json: string): Promise<void> {
    await this.pub.publish(channel, json);
  }

  async subscribe(channel: string, handler: (json: string) => void): Promise<() => Promise<void>> {
    let hs = this.handlers.get(channel);
    if (!hs) {
      hs = new Set();
      this.handlers.set(channel, hs);
      await this.sub.subscribe(channel);
    }
    hs.add(handler);
    return async () => {
      const set = this.handlers.get(channel);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(channel);
        await this.sub.unsubscribe(channel).catch(() => {});
      }
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await this.sub.quit().catch(() => {});
  }
}

export class RedisSnapshotStore implements SnapshotStore {
  constructor(private readonly redis: Redis) {}

  async save(code: string, snapshot: RoomSnapshot): Promise<void> {
    await this.redis.set(`room:${code}:snapshot`, JSON.stringify(snapshot), "PX", SNAPSHOT_TTL_MS);
  }

  async load(code: string): Promise<RoomSnapshot | null> {
    const raw = await this.redis.get(`room:${code}:snapshot`);
    return raw ? (JSON.parse(raw) as RoomSnapshot) : null;
  }

  async delete(code: string): Promise<void> {
    await this.redis.del(`room:${code}:snapshot`);
  }
}

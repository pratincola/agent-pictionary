/**
 * Infrastructure behind the room manager (PLAN.md §9.6, §12). Phase 1 ships
 * the in-memory versions (one node, all rooms local); Phase 4 adds the Redis
 * versions in `redis.ts`, selected by `REDIS_URL`.
 */
import type { RoomState } from "@pictionary/engine";

/** What a node publishes about itself so other nodes can redirect to it. */
export interface NodeInfo {
  nodeId: string;
  /** Public REST base, no trailing slash (e.g. https://arena.example.com). */
  restBase: string;
  /** Public WebSocket base, no trailing slash (e.g. wss://arena.example.com). */
  wsBase: string;
}

/** Which node hosts a room's actor. */
export interface RoomDirectory {
  /** Claim a room for this node. False when another node owns it. */
  claim(code: string, nodeId: string): Promise<boolean>;
  lookup(code: string): Promise<string | null>;
  /** Release the entry and forget the room (only if this node owns the entry). */
  release(code: string, nodeId: string): Promise<void>;
  /** Release the entry but keep the room in this node's restore list (shutdown). */
  unpin(code: string, nodeId: string): Promise<void>;
  /** Renew this node's entry and the entries of the rooms it owns. */
  heartbeat(nodeId: string, codes: readonly string[]): Promise<void>;
  registerNode(info: NodeInfo): Promise<void>;
  unregisterNode(nodeId: string): Promise<void>;
  getNode(nodeId: string): Promise<NodeInfo | null>;
  /** Rooms this node owned before a restart (for snapshot restore). */
  ownedRooms(nodeId: string): Promise<string[]>;
  close(): Promise<void>;
}

export class InMemoryRoomDirectory implements RoomDirectory {
  private owners = new Map<string, string>();
  private nodes = new Map<string, NodeInfo>();
  private restorable = new Map<string, Set<string>>();
  async claim(code: string, nodeId: string): Promise<boolean> {
    const cur = this.owners.get(code);
    if (cur && cur !== nodeId) return false;
    this.owners.set(code, nodeId);
    let set = this.restorable.get(nodeId);
    if (!set) {
      set = new Set();
      this.restorable.set(nodeId, set);
    }
    set.add(code);
    return true;
  }
  async lookup(code: string): Promise<string | null> {
    return this.owners.get(code) ?? null;
  }
  async release(code: string, nodeId: string): Promise<void> {
    if (this.owners.get(code) === nodeId) this.owners.delete(code);
    this.restorable.get(nodeId)?.delete(code);
  }
  async unpin(code: string, nodeId: string): Promise<void> {
    if (this.owners.get(code) === nodeId) this.owners.delete(code);
  }
  async heartbeat(): Promise<void> {}
  async registerNode(info: NodeInfo): Promise<void> {
    this.nodes.set(info.nodeId, info);
  }
  async unregisterNode(nodeId: string): Promise<void> {
    this.nodes.delete(nodeId);
  }
  async getNode(nodeId: string): Promise<NodeInfo | null> {
    return this.nodes.get(nodeId) ?? null;
  }
  async ownedRooms(nodeId: string): Promise<string[]> {
    return [...(this.restorable.get(nodeId) ?? [])];
  }
  async close(): Promise<void> {}
}

/**
 * Fan-out of room events to read-only subscribers (spectators on other
 * nodes). Messages are the exact JSON the owning actor broadcast, already
 * serialized, so relays never re-stringify.
 */
export interface EventBus {
  publish(channel: string, json: string): Promise<void>;
  subscribe(channel: string, handler: (json: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export class InMemoryEventBus implements EventBus {
  private handlers = new Map<string, Set<(m: string) => void>>();
  async publish(channel: string, json: string): Promise<void> {
    const hs = this.handlers.get(channel);
    if (!hs) return;
    for (const h of hs) h(json);
  }
  async subscribe(channel: string, handler: (m: string) => void): Promise<() => Promise<void>> {
    let hs = this.handlers.get(channel);
    if (!hs) {
      hs = new Set();
      this.handlers.set(channel, hs);
    }
    hs.add(handler);
    return async () => {
      hs?.delete(handler);
    };
  }
  async close(): Promise<void> {
    this.handlers.clear();
  }
}

/** What a node saves so it can restore a room after a restart. */
export interface RoomSnapshot {
  nodeId: string;
  roomId: string;
  state: RoomState;
  /** Pending engine timers (`schedule` effects) at snapshot time. */
  timers: { timerId: string; at: number }[];
  savedAt: number;
}

export interface SnapshotStore {
  save(code: string, snapshot: RoomSnapshot): Promise<void>;
  load(code: string): Promise<RoomSnapshot | null>;
  delete(code: string): Promise<void>;
}

/** Keeps nothing across restarts; exists so the manager has one code path. */
export class InMemorySnapshotStore implements SnapshotStore {
  private snaps = new Map<string, RoomSnapshot>();
  async save(code: string, snapshot: RoomSnapshot): Promise<void> {
    this.snaps.set(code, snapshot);
  }
  async load(code: string): Promise<RoomSnapshot | null> {
    return this.snaps.get(code) ?? null;
  }
  async delete(code: string): Promise<void> {
    this.snaps.delete(code);
  }
}

export function roomChannel(code: string): string {
  return `room:${code}:events`;
}

/** Owner -> relays: `{"type":"room.closed"}` when the actor goes away. */
export function roomControlChannel(code: string): string {
  return `room:${code}:control`;
}

/**
 * Interfaces that Phase 4 swaps for Redis-backed implementations. Phase 1
 * ships in-memory versions: one node, all rooms local.
 */
import type { ServerMessage } from "@pictionary/protocol";

/** Which node hosts a room's actor (PLAN.md §9.6). */
export interface RoomDirectory {
  /** Claim a room for this node. False when another node owns it. */
  claim(code: string, nodeId: string): Promise<boolean>;
  lookup(code: string): Promise<string | null>;
  release(code: string): Promise<void>;
  heartbeat(nodeId: string): Promise<void>;
}

export class InMemoryRoomDirectory implements RoomDirectory {
  private owners = new Map<string, string>();
  async claim(code: string, nodeId: string): Promise<boolean> {
    const cur = this.owners.get(code);
    if (cur && cur !== nodeId) return false;
    this.owners.set(code, nodeId);
    return true;
  }
  async lookup(code: string): Promise<string | null> {
    return this.owners.get(code) ?? null;
  }
  async release(code: string): Promise<void> {
    this.owners.delete(code);
  }
  async heartbeat(): Promise<void> {}
}

/** Fan-out of room events to read-only subscribers (spectators on other nodes). */
export interface EventBus {
  publish(channel: string, message: ServerMessage): Promise<void>;
  subscribe(channel: string, handler: (message: ServerMessage) => void): Promise<() => void>;
}

export class InMemoryEventBus implements EventBus {
  private handlers = new Map<string, Set<(m: ServerMessage) => void>>();
  async publish(channel: string, message: ServerMessage): Promise<void> {
    const hs = this.handlers.get(channel);
    if (!hs) return;
    for (const h of hs) h(message);
  }
  async subscribe(channel: string, handler: (m: ServerMessage) => void): Promise<() => void> {
    let hs = this.handlers.get(channel);
    if (!hs) {
      hs = new Set();
      this.handlers.set(channel, hs);
    }
    hs.add(handler);
    return () => {
      hs?.delete(handler);
    };
  }
}

export function roomChannel(code: string): string {
  return `room:${code}:events`;
}

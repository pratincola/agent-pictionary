import type { RoomInit } from "@pictionary/engine";
import type { Entitlement, PictionaryConfig, RoomStateSnapshot } from "@pictionary/protocol";
import type { Logger } from "pino";
import { generateRoomCode, newId } from "../auth.js";
import type { Metrics } from "../metrics.js";
import type { Repo } from "../repo.js";
import { RoomActor } from "./actor.js";
import {
  type EventBus,
  type NodeInfo,
  type RoomDirectory,
  roomControlChannel,
  type SnapshotStore,
} from "./infra.js";
import type { Persistence } from "./persistence.js";
import { RemoteRoom } from "./remote.js";

export interface ManagerDeps {
  log: Logger;
  repo: Repo;
  persistence: Persistence;
  bus: EventBus;
  directory: RoomDirectory;
  snapshots: SnapshotStore;
  nodeId: string;
  validateOutgoing: boolean;
  metrics?: Metrics;
  /** Directory TTL; heartbeat runs every ttl/3. */
  roomTtlMs: number;
  /** Fetch the spectator snapshot of a room from its owning node. */
  fetchRemoteSnapshot: (node: NodeInfo, code: string) => Promise<RoomStateSnapshot | null>;
}

export type RoomLocation =
  | { kind: "local"; actor: RoomActor }
  | { kind: "remote"; node: NodeInfo }
  | { kind: "none" };

/**
 * Owns every RoomActor on this node plus the read-only relays for rooms
 * other nodes own. Single writer: an actor runs on exactly one node, the one
 * that holds `room:{code}` in the directory.
 */
export class RoomManager {
  private readonly actors = new Map<string, RoomActor>();
  private readonly relays = new Map<string, RemoteRoom>();
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private node: NodeInfo | undefined;
  private closing = false;

  constructor(private readonly deps: ManagerDeps) {}

  get nodeId(): string {
    return this.deps.nodeId;
  }

  get(code: string): RoomActor | undefined {
    return this.actors.get(code);
  }

  getRelay(code: string): RemoteRoom | undefined {
    return this.relays.get(code);
  }

  list(): RoomActor[] {
    return [...this.actors.values()];
  }

  queueDepth(): number {
    let n = 0;
    for (const a of this.actors.values()) n += a.queueDepth;
    return n;
  }

  /** Where a room lives: here, on another node (with its public bases), or nowhere. */
  async locate(code: string): Promise<RoomLocation> {
    const actor = this.actors.get(code);
    if (actor) return { kind: "local", actor };
    const owner = await this.deps.directory.lookup(code);
    if (!owner || owner === this.deps.nodeId) return { kind: "none" };
    const node = await this.deps.directory.getNode(owner);
    if (!node) return { kind: "none" };
    return { kind: "remote", node };
  }

  /** Relay for spectators of a room another node owns. */
  relay(code: string, node: NodeInfo): RemoteRoom {
    let r = this.relays.get(code);
    if (r) return r;
    const relay = new RemoteRoom(code, {
      log: this.deps.log,
      bus: this.deps.bus,
      ...(this.deps.metrics ? { metrics: this.deps.metrics } : {}),
      fetchSnapshot: () => this.deps.fetchRemoteSnapshot(node, code),
      onEmpty: () => {
        if (this.relays.get(code) === relay) this.relays.delete(code);
      },
    });
    r = relay;
    this.relays.set(code, r);
    return r;
  }

  /** Register the node, start the heartbeat, restore rooms this node owned before a restart. */
  async start(node: NodeInfo): Promise<void> {
    this.node = node;
    await this.deps.directory.registerNode(node);
    const every = Math.max(250, Math.floor(this.deps.roomTtlMs / 3));
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), every);
    this.heartbeatTimer.unref();
    await this.restoreAll();
  }

  /** Stop renewing directory entries (tests simulate a hung node; closeAll uses it too). */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private async heartbeat(): Promise<void> {
    if (this.closing) return;
    try {
      if (this.node) await this.deps.directory.registerNode(this.node);
      await this.deps.directory.heartbeat(this.deps.nodeId, [...this.actors.keys()]);
    } catch (err) {
      this.deps.log.warn({ err }, "directory heartbeat failed");
    }
  }

  private async restoreAll(): Promise<void> {
    let codes: string[] = [];
    try {
      codes = await this.deps.directory.ownedRooms(this.deps.nodeId);
    } catch (err) {
      this.deps.log.warn({ err }, "could not list owned rooms");
      return;
    }
    for (const code of codes) {
      if (this.actors.has(code)) continue;
      try {
        const snap = await this.deps.snapshots.load(code);
        if (!snap || snap.state.status === "finished") {
          await this.deps.snapshots.delete(code);
          await this.deps.directory.release(code, this.deps.nodeId);
          continue;
        }
        if (!(await this.deps.directory.claim(code, this.deps.nodeId))) {
          this.deps.log.warn({ code }, "room owned by another node; not restoring");
          continue;
        }
        this.spawn(code, snap.roomId, { restore: snap });
        this.deps.log.info(
          { code, status: snap.state.status, savedAt: snap.savedAt },
          "room restored from snapshot",
        );
      } catch (err) {
        this.deps.log.error({ err, code }, "room restore failed");
      }
    }
  }

  async create(opts: {
    config: PictionaryConfig;
    creatorAgentId?: string;
    creatorHumanId?: string;
  }): Promise<RoomActor> {
    if (this.closing) throw new Error("node is shutting down");
    let code = generateRoomCode();
    for (
      let i = 0;
      i < 20 &&
      (this.actors.has(code) || !(await this.deps.directory.claim(code, this.deps.nodeId)));
      i++
    ) {
      code = generateRoomCode();
    }
    const roomId = newId();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const init: RoomInit = { code, config: opts.config, seed };
    if (opts.creatorAgentId) init.creatorAgentId = opts.creatorAgentId;
    if (opts.creatorHumanId) init.creatorHumanId = opts.creatorHumanId;
    await this.deps.repo.createRoom({
      id: roomId,
      code,
      gameId: "pictionary",
      config: opts.config,
      seed,
      ...(opts.creatorAgentId ? { creatorAgentId: opts.creatorAgentId } : {}),
      ...(opts.creatorHumanId ? { creatorHumanId: opts.creatorHumanId } : {}),
    });
    const actor = this.spawn(code, roomId, init);
    this.saveSnapshot(code, actor.snapshot());
    this.deps.log.info({ code, roomId }, "room created");
    return actor;
  }

  private spawn(code: string, roomId: string, init: ConstructorParameters<typeof RoomActor>[0]) {
    const actor = new RoomActor(init, {
      log: this.deps.log,
      persistence: this.deps.persistence,
      bus: this.deps.bus,
      roomId,
      validateOutgoing: this.deps.validateOutgoing,
      ...(this.deps.metrics ? { metrics: this.deps.metrics } : {}),
      onStatusChange: (status) => {
        void this.deps.repo.setRoomStatus(roomId, status).catch((err) => {
          this.deps.log.warn({ err, code }, "room status update failed");
        });
      },
      onIdle: () => {
        if (actor.peek().status === "finished") void this.remove(code);
      },
      onSnapshot: (snap) => this.saveSnapshot(code, snap),
    });
    this.actors.set(code, actor);
    this.deps.metrics?.roomsActive.set(this.actors.size);
    return actor;
  }

  private saveSnapshot(code: string, snap: ReturnType<RoomActor["snapshot"]>): void {
    void this.deps.snapshots
      .save(code, { ...snap, nodeId: this.deps.nodeId, savedAt: Date.now() })
      .catch((err) => this.deps.log.warn({ err, code }, "snapshot save failed"));
  }

  /** Push an entitlement change to every room where the agent plays. */
  broadcastEntitlements(agentId: string, entitlements: Entitlement[]): void {
    for (const a of this.actors.values()) {
      if (a.peek().players[agentId])
        a.enqueue({ kind: "agent.entitlements", agentId, entitlements });
    }
  }

  /** Close a room for good: actor, snapshot, directory entry, relays elsewhere. */
  async remove(code: string): Promise<void> {
    const a = this.actors.get(code);
    if (!a) return;
    this.actors.delete(code);
    this.deps.metrics?.roomsActive.set(this.actors.size);
    await a.close();
    await Promise.all([
      this.deps.snapshots.delete(code).catch(() => {}),
      this.deps.directory.release(code, this.deps.nodeId).catch(() => {}),
      this.deps.bus
        .publish(roomControlChannel(code), JSON.stringify({ type: "room.closed" }))
        .catch(() => {}),
    ]);
  }

  /**
   * Node shutdown: drain every actor, keep snapshots so the same NODE_ID can
   * restore unfinished rooms, release the directory entries, unregister.
   */
  async closeAll(): Promise<void> {
    this.closing = true;
    this.stopHeartbeat();
    const codes = [...this.actors.keys()];
    for (const code of codes) {
      const a = this.actors.get(code);
      if (!a) continue;
      this.actors.delete(code);
      await a.close();
      const snap = a.snapshot();
      if (snap.state.status === "finished") await this.deps.snapshots.delete(code).catch(() => {});
      else
        await this.deps.snapshots
          .save(code, { ...snap, nodeId: this.deps.nodeId, savedAt: Date.now() })
          .catch(() => {});
      // Entry goes so other nodes answer 404 instead of redirecting to a dead
      // node; the membership stays so `restoreAll` can claim it again.
      if (snap.state.status === "finished")
        await this.deps.directory.release(code, this.deps.nodeId).catch(() => {});
      else await this.deps.directory.unpin(code, this.deps.nodeId).catch(() => {});
    }
    this.deps.metrics?.roomsActive.set(0);
    await Promise.all([...this.relays.values()].map((r) => r.close(1001, "server shutting down")));
    this.relays.clear();
    await this.deps.directory.unregisterNode(this.deps.nodeId).catch(() => {});
  }
}

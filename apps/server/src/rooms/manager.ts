import type { RoomInit } from "@pictionary/engine";
import type { Entitlement, PictionaryConfig } from "@pictionary/protocol";
import type { Logger } from "pino";
import { generateRoomCode, newId } from "../auth.js";
import type { Repo } from "../repo.js";
import { RoomActor } from "./actor.js";
import type { EventBus, RoomDirectory } from "./infra.js";
import type { Persistence } from "./persistence.js";

export interface ManagerDeps {
  log: Logger;
  repo: Repo;
  persistence: Persistence;
  bus: EventBus;
  directory: RoomDirectory;
  nodeId: string;
  validateOutgoing: boolean;
}

/** Owns every RoomActor on this node. Phase 4 adds the Redis directory lookups. */
export class RoomManager {
  private readonly actors = new Map<string, RoomActor>();

  constructor(private readonly deps: ManagerDeps) {}

  get(code: string): RoomActor | undefined {
    return this.actors.get(code);
  }

  list(): RoomActor[] {
    return [...this.actors.values()];
  }

  async create(opts: {
    config: PictionaryConfig;
    creatorAgentId?: string;
    creatorHumanId?: string;
  }): Promise<RoomActor> {
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
    const actor = new RoomActor(init, {
      log: this.deps.log,
      persistence: this.deps.persistence,
      bus: this.deps.bus,
      roomId,
      validateOutgoing: this.deps.validateOutgoing,
      onStatusChange: (status) => {
        void this.deps.repo.setRoomStatus(roomId, status).catch((err) => {
          this.deps.log.warn({ err, code }, "room status update failed");
        });
      },
      onIdle: () => {
        if (actor.peek().status === "finished") void this.remove(code);
      },
    });
    this.actors.set(code, actor);
    this.deps.log.info({ code, roomId }, "room created");
    return actor;
  }

  /** Push an entitlement change to every room where the agent plays. */
  broadcastEntitlements(agentId: string, entitlements: Entitlement[]): void {
    for (const a of this.actors.values()) {
      if (a.peek().players[agentId])
        a.enqueue({ kind: "agent.entitlements", agentId, entitlements });
    }
  }

  async remove(code: string): Promise<void> {
    const a = this.actors.get(code);
    if (!a) return;
    this.actors.delete(code);
    await a.close();
    await this.deps.directory.release(code);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.actors.keys()].map((c) => this.remove(c)));
  }
}

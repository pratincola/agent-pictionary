/**
 * Prometheus metrics (PLAN.md §13). One Registry per server instance so
 * several in-process servers (tests) do not collide. Served at GET /metrics.
 */
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";

export class Metrics {
  readonly registry = new Registry();
  readonly roomsActive: Gauge;
  readonly sessionsConnected: Gauge<"role">;
  readonly wsMessages: Counter<"direction">;
  readonly drawOps: Counter;
  readonly guesses: Counter<"result">;
  readonly roundDuration: Histogram;
  readonly broadcastLatency: Histogram;
  readonly actorQueueDepth: Gauge;
  readonly restRateLimited: Counter<"route">;

  constructor(nodeId: string, opts: { queueDepth?: () => number } = {}) {
    this.registry.setDefaultLabels({ node: nodeId });
    collectDefaultMetrics({ register: this.registry });
    const registers = [this.registry];
    this.roomsActive = new Gauge({
      name: "ap_rooms_active",
      help: "Rooms hosted by this node (actor running).",
      registers,
    });
    this.sessionsConnected = new Gauge({
      name: "ap_sessions_connected",
      help: "Open WebSocket sessions by role (relayed spectators included).",
      labelNames: ["role"] as const,
      registers,
    });
    this.wsMessages = new Counter({
      name: "ap_ws_messages_total",
      help: "WebSocket messages received (in) and sent (out).",
      labelNames: ["direction"] as const,
      registers,
    });
    this.drawOps = new Counter({
      name: "ap_draw_ops_total",
      help: "Draw ops accepted by room actors.",
      registers,
    });
    this.guesses = new Counter({
      name: "ap_guesses_total",
      help: "Guesses processed, by result.",
      labelNames: ["result"] as const,
      registers,
    });
    this.roundDuration = new Histogram({
      name: "ap_round_duration_seconds",
      help: "Round length from round.started to round.ended.",
      buckets: [5, 10, 20, 30, 45, 60, 90, 120, 180],
      registers,
    });
    this.broadcastLatency = new Histogram({
      name: "ap_broadcast_latency_seconds",
      help: "Socket receipt (recvNs) to the moment the actor hands the broadcast to every socket.",
      buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1],
      registers,
    });
    this.actorQueueDepth = new Gauge({
      name: "ap_actor_queue_depth",
      help: "Events waiting in room actor queues (sum over rooms on this node).",
      registers,
      collect() {
        if (opts.queueDepth) this.set(opts.queueDepth());
      },
    });
    this.restRateLimited = new Counter({
      name: "ap_rest_rate_limited_total",
      help: "REST requests rejected with 429, by route.",
      labelNames: ["route"] as const,
      registers,
    });
    for (const r of ["agent", "human", "spectator"]) this.sessionsConnected.set({ role: r }, 0);
    for (const d of ["in", "out"]) this.wsMessages.inc({ direction: d }, 0);
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}

# Load test report (Phase 4)

PLAN.md §14.5: 20 rooms × (8 agents + 50 spectators), drawer at 20 ops/s for
60 s, guessers guessing at random. Target: p95 broadcast latency < 50 ms on
one VPS core. Measured 2026-11-10 with `pnpm load` (see `docs/TESTING.md`).

## Hardware

Development container, not the Hetzner VPS:

- 2 vCPU Intel Xeon @ 2.1–2.3 GHz (hypervisor-throttled), 8 GB RAM
- Linux 6.18, Node v22.23.4
- Postgres 16 and the load generator (4 client worker threads, 1,160–2,320
  sockets) ran on the same box as the server, so the server shared its two
  cores with its own clients. Numbers on a dedicated CX22 should be no worse.

## Method

- Server in its own process (`apps/server/dist/main.js`, in-memory directory,
  `LOG_LEVEL=warn`), sampled through `GET /metrics` every 2 s.
- Each socket timestamps every `draw.op` on receipt and subtracts the server
  `ts` stamped at broadcast (same host, same clock; 0.1 ms histogram buckets).
- Server-side `ap_broadcast_latency_seconds` measures `recvNs` (socket read,
  before JSON parse) to the end of the fan-out loop; values are bucket upper
  bounds.
- Every socket audits `opSeq` contiguity (1..N, no gap, no duplicate) and
  that it received every op the drawer sent.
- Guessers send two wrong guesses each at random times (280 guesses total in
  the target run), keeping one so the round does not end `exhausted`.

## Results

| Run | Rooms | Sockets | ops sent | Client p50 / p95 / p99 / max (ms) | Server p50 / p95 / p99 (≤ ms) | ws out msgs/s | CPU (one core) | RSS peak | Contiguous |
|-----|-------|---------|----------|-----------------------------------|-------------------------------|---------------|----------------|----------|------------|
| Half (10 rooms, 30 s) | 10 | 580 | 5,979 | 0.9 / 1.6 / 2.6 / 19.2 | 0.5 / 1 / 2 | 9,902 | 28 % | 176 MB | 580/580 |
| **Target (20 rooms, 60 s)** | 20 | 1,160 | 23,911 | **0.9 / 1.8 / 3.0 / 26.6** | 0.5 / 1 / 2 | **19,524** | **37 %** | **205 MB** | **1,160/1,160** |
| Headroom (40 rooms, 30 s) | 40 | 2,320 | 23,875 | 1.0 / 2.4 / 4.0 / 12.9 | 0.5 / 1 / 2 | 26,164 | 64 % | 227 MB | 2,320/2,320 |

Target run detail (`n` = 1,386,838 draw.op receipts):

- p95 **1.8 ms** against the 50 ms target; p99 3.0 ms; the worst single
  receipt was 26.6 ms (one event-loop stall; `nodejs_eventloop_lag_p99` was
  24 ms at the end of the run, dominated by the 2 s metrics scrape and GC).
- `ap_actor_queue_depth` stayed at 0 on every sample: actors never fell
  behind the 20 ops/s per room.
- 0 gaps, 0 short sockets: every one of the 1,160 sockets saw `opSeq`
  1..1,195/1,196 contiguously, and every op the drawer sent was delivered
  before the socket closed.
- Server inbound 333 msgs/s (ops + guesses + acks), outbound 19.5k msgs/s;
  the clients observed the same count.
- CPU 37 % of one core for 20 rooms, roughly linear in sockets × ops/s
  (64 % at 2,320 sockets). RSS grew from 132 MB to 205 MB (about 60 KB per
  socket, mostly `ws` buffers) and stays flat after the sockets close.
- One server-side sample fell in the 100–250 ms bucket: the histogram also
  covers client events whose step awaits a Postgres write before the
  broadcast (`room.ready` → `match.started` persists first, PLAN.md §9.5),
  so that bucket is the DB round-trip, not fan-out time.

## What was not needed

The target was met without profiling. The hot path already serializes each
broadcast once per actor step and sends the same string to every socket;
outbound schema validation (`validateOutgoing`) is off outside tests.
Possible further wins if a future load needs them: pre-framing the WebSocket
frame once per broadcast (`ws` currently frames per socket), and batching
several draw ops per message from the drawer (the protocol allows ≤ 20 per
`draw.ops`).

## Reproduce

```sh
scripts/dev-services.sh
createdb -h /tmp -p 5433 -U postgres pictionary_load
DATABASE_URL=postgres://postgres@localhost:5433/pictionary_load pnpm load
# or against a running server (raise its RATE_LIMIT_* first):
pnpm -F @pictionary/bots load --base http://127.0.0.1:8080 --rooms 20 --json /tmp/load.json
```

Exit code 3 when p95 ≥ 50 ms or any socket saw a gap.

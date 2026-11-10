# Phase 3 decisions

Decisions Claude Code made while building Phase 3 pieces that PLAN.md /
PROTOCOL.md did not pin down. Each says why. Append new sections per piece.

## `apps/mcp` (2026-11-10)

- **Official `@modelcontextprotocol/sdk` 1.32.2 (exact pin), stdio only.**
  Latest stable at build time. Claude Code, Hermes and OpenClaw all speak
  stdio; HTTP transport can be added later without touching the tools.
- **One process = one agent = one room.** The `Session` holds one
  `AgentClient`. `join_room` on a different code leaves the current room
  first (an LLM that forgets `leave_room` should not get stuck). Two agents
  on one machine run two host processes with different `AP_CONFIG` paths.
- **Identity file `AP_CONFIG`** (default `~/.agent-pictionary/agent.json`)
  stores `{ agentId, apiKey, name, humanPairCode }`, written atomically with
  mode 0600 in a 0700 directory, because the api key is shown once by
  `POST /agents`. `register_agent` is idempotent and returns the stored
  identity unless `force: true`; the stored name wins over the argument.
- **Tool results are compact text, not structured output.** The player is
  an LLM; a few labelled lines cost fewer tokens than JSON and read better in
  a transcript. `get_canvas_png` is the one exception (MCP image content,
  base64 PNG rendered locally by `@pictionary/render` from the op log, no
  server round trip). Every failure is `isError: true` text with the protocol
  code first (`NOT_DRAWER: ...`, `ENTITLEMENT_REQUIRED: ... (needs the
  "erase" entitlement)`), so the model can branch on it. Nothing a tool
  returns ever includes another agent's guess text: agents never receive
  `guess.feed` (server redaction), and the summaries print only counts and
  scores.
- **`wait_for_event` serves buffered events first.** `round.wordOptions`
  lands in the same actor step as `round.choosing`, before the model can ask
  for it. The session keeps a bounded buffer (500) of notable server
  messages; a call returns the first unconsumed match at once, otherwise the
  next matching arrival, and drops buffered events older than the one it
  returned. `draw.op`, `ack`, `pong`, `guess.result`, `guess.feed` and
  replied-to `error`s are not buffered (noise, or already surfaced as the
  tool's own result). The `round.choosing` summary for the drawer also lists
  the word options inline, so a player that waits only for `round.choosing`
  can still choose at once. Timeout is capped at 120 s (MCP hosts have their
  own call timeouts) and is a normal result (`timeout: ...`), not an error.
- **`draw` takes at most 100 ops per call.** The SDK paces at the server's
  30 ops/s, so 100 ops is about 3.5 s of blocking; the tool description tells
  the model to send the outline first and details in later calls. Input is
  validated by the protocol `DrawOp` zod schema (bounds, widths, no text op)
  before the handler runs, and the error names the field.
- **Spectator URL is `<AP_WEB_BASE>/r/<code>`**, matching the web route from
  Phase 2. `AP_WEB_BASE` defaults to the Vite dev server (`:5173`).
- **Tests use the real server in-process** (copy of `packages/sdk/test/server.ts`
  with database `pictionary_mcp` and port 3300) and the official MCP `Client`
  over `InMemoryTransport`, so the whole stdio-free path (tool schema → zod →
  handler → SDK → sockets → engine) is exercised. Text assertions parse the
  same summaries an LLM would read.
- **Root wiring.** `apps/mcp` is added to `tsconfig.build.json` so `pnpm
  build` produces `apps/mcp/dist/main.js`; root scripts `build:mcp` and
  `mcp`. The vitest "source" condition does not resolve externalized
  workspace packages under vitest 5 / vite 8, so tests need `pnpm build`
  (or `pnpm typecheck`, which emits) once before `pnpm test`; TESTING.md's
  one-command flow already does this.

## `apps/bots` stroke library (2026-11-10)

- **Every easy word has a drawing; medium is best effort (129/134).** The
  engine offers one word per tier each round and `LibraryDrawer.choose`
  takes the first option in the library, so full easy coverage means the
  scripted drawer never falls back to the `?` placeholder unless all three
  options are hard. `school`, `library`, `zoo`, `jungle` and `glacier` were
  left out: as plain line icons each reads as another pool word (`house`,
  `book`, an animal, `tree`, `mountain`), and a wrong-but-confident drawing
  is worse than the placeholder. Hard words stay uncovered (abstract nouns).
- **Drawings are code, JSON is generated.** `drawings*.ts` compose a small
  set of primitives (`shapes.ts`) and reusable parts (`parts.ts`: quadruped
  body, stick figure, face, wheel, flame). Op transforms (`translate`,
  `scale`, `mirrorX`, `rotate`) let one shape serve several words (`horse` ->
  `zebra`/`unicorn`, `barn` -> `farm`, a boxing glove and its mirror). The
  JSON files are the artifact other clients consume; the test asserts they
  equal the generator output so the two cannot drift.
- **Budget per drawing: 6-80 ops, ink plus at most two accent colors.**
  Enforced by tests (`rainbow` is the one exemption). The lower bound keeps a
  streamed drawing from finishing in a second; the colour cap keeps the icons
  consistent and stops colour alone from carrying the answer. A few base
  drawings (`star`, `heart`, `lightning`, `egg`) gained context details
  (small stars, a cloud, an egg cup) to meet the floor.
- **Contact sheets are the review tool.** `gen:library` writes
  `library/preview/contact-sheet-<tier>.png` with the word under each 256 px
  tile. The label is canvas text in the preview only; the ops never contain
  letters (the game bans them and no text op exists). Reviewing the sheets
  drove two rounds of fixes (arm, shoe, boxing, mummy, pancake, pretzel, fox
  tail, corn husk, mermaid tail, traffic light colours).
- **`@napi-rs/canvas` is a direct dependency of bots** (same pinned version
  as `packages/render`) only for the preview labels; `renderPng` from
  `@pictionary/render` draws the tiles so previews match what spectators see.

import { expect, type Page, test } from "@playwright/test";
import { E2E } from "../playwright.config.js";
import {
  chosenWord,
  createSession,
  drawAll,
  extraLines,
  missAll,
  type Player,
  setupRoom,
  smileyOps,
  startAndChoose,
  WsClient,
} from "./bots.js";

const SHOTS = "e2e/screenshots";

/** Count canvas pixels darker than the paper. */
async function inkedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>("[data-testid=canvas]");
    if (!c) return -1;
    const ctx = c.getContext("2d");
    if (!ctx) return -1;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] as number;
      const g = d[i + 1] as number;
      const b = d[i + 2] as number;
      if (r < 200 || g < 200 || b < 200) n++;
    }
    return n;
  });
}

async function joinAsSpectator(page: Page, code: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("code-input").fill(code);
  await page.getByTestId("join-button").click();
  await expect(page).toHaveURL(new RegExp(`/r/${code}$`));
  await expect(page.getByTestId("room-code")).toHaveText(code);
}

async function joinAsHuman(page: Page, code: string, pairCode: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("code-input").fill(code);
  await page.getByTestId("human-toggle").check();
  await page.getByTestId("pair-input").fill(pairCode);
  await page.getByTestId("join-button").click();
  await expect(page).toHaveURL(new RegExp(`/r/${code}$`));
  await expect(page.getByTestId("human-panel")).toBeVisible();
}

test.describe("spectator and human during a bot match", () => {
  let players: Player[] = [];
  const extraSockets: WsClient[] = [];

  test.afterEach(async () => {
    await Promise.all([...players, ...extraSockets.map((ws) => ({ ws }))].map((p) => p.ws.close()));
    players = [];
    extraSockets.length = 0;
  });

  test("live canvas, feed, human extra guess, reveal, reconnect, human note", async ({
    browser,
  }) => {
    const base = E2E.serverBase;
    const room = await setupRoom(base, 3, { revealSeconds: 2, drawSeconds: 120 });
    players = room.players;
    const code = room.room.code;

    // --- Spectator in the lobby --------------------------------------------
    const spectator = await browser.newPage();
    await joinAsSpectator(spectator, code);
    await expect(spectator.getByTestId("phase")).toHaveText(/lobby/);
    await expect(spectator.getByTestId("lobby-overlay")).toBeVisible();
    await expect(spectator.getByTestId("player-row")).toHaveCount(3);
    // Spectators never get a Start button.
    await expect(spectator.getByTestId("start-button")).toHaveCount(0);

    // --- Match starts; drawer picks option 0 --------------------------------
    const { drawer, guessers } = await startAndChoose(players);
    const order = (await (players[0] as Player).ws.any("match.started")).payload.order;
    const word = chosenWord(drawer);
    await expect(spectator.getByTestId("phase")).toHaveText(/drawing/);
    await expect(spectator.getByTestId("drawer-name")).toContainText(drawer.name);
    await expect(spectator.getByTestId("word-pattern")).toHaveText(
      word.replace(/[^ ]/g, "_").trim(),
    );
    await expect(spectator.getByTestId("countdown")).toHaveText(/^\d:\d\d$/);

    // --- Paired human joins mid-round; its agent is round 2's drawer --------
    const nextDrawer = players.find((p) => p.agentId === order[1]) as Player;
    expect(nextDrawer).not.toBe(drawer);
    const human = await browser.newPage();
    await joinAsHuman(human, code, nextDrawer.pairCode);
    await expect(human.getByTestId("my-agent")).toHaveText(nextDrawer.name);
    await expect(human.getByTestId("human-input")).toBeDisabled();
    await expect(human.getByTestId("human-hint")).toHaveText("Your agent still has 3 guesses");
    await expect(human.getByTestId("agent-left")).toHaveText("3");
    await expect(human.getByTestId("human-left")).toHaveText("3");

    // --- Drawer draws ~40 ops; the canvas fills in ---------------------------
    expect(await inkedPixels(spectator)).toBe(0);
    const ops = smileyOps();
    expect(ops).toHaveLength(40);
    const lastSeq = await drawAll(drawer, ops);
    expect(lastSeq).toBe(40);
    await expect(spectator.getByTestId("canvas")).toHaveAttribute("data-ops", "40");
    await expect(human.getByTestId("canvas")).toHaveAttribute("data-ops", "40");
    await expect.poll(() => inkedPixels(spectator)).toBeGreaterThan(2_000);
    await spectator.screenshot({ path: `${SHOTS}/drawing.png` });

    // --- Reconnect: drop the socket, miss 20 ops, resync from the snapshot ---
    await spectator.evaluate(() =>
      (window as Window & { __apDropSocket?: () => void }).__apDropSocket?.(),
    );
    await expect(spectator.getByTestId("conn")).toHaveAttribute("data-status", "reconnecting");
    await drawAll(drawer, extraLines(20));
    await expect(spectator.getByTestId("conn")).toHaveAttribute("data-status", "open");
    await expect(spectator.getByTestId("canvas")).toHaveAttribute("data-ops", "60");
    await expect(spectator.getByTestId("phase")).toHaveText(/drawing/);
    await expect.poll(() => inkedPixels(spectator)).toBeGreaterThan(2_000);

    // --- Two guessers miss 3 times each -> 6 incorrect feed items -----------
    await missAll(guessers, 3);
    await expect(spectator.getByTestId("feed-item")).toHaveCount(6);
    await expect(spectator.locator("[data-testid=feed-item][data-result=incorrect]")).toHaveCount(
      6,
    );
    await expect(spectator.locator("[data-testid=feed-item][data-source=agent]")).toHaveCount(6);
    await expect(spectator.getByTestId("feed-count")).toHaveText("6");

    // --- Human input unlocks once the agent's guesses are spent --------------
    await expect(human.getByTestId("agent-left")).toHaveText("0");
    await expect(human.getByTestId("human-input")).toBeEnabled();
    await expect(human.getByTestId("human-hint")).toHaveText("3 guesses left");
    await human.screenshot({ path: `${SHOTS}/human.png` });

    // A wrong human guess first: result shown, counter drops.
    await human.getByTestId("human-input").fill("submarine sandwich");
    await human.getByTestId("human-submit").click();
    await expect(human.getByTestId("human-result")).toHaveAttribute("data-result", "incorrect");
    await expect(human.getByTestId("human-left")).toHaveText("2");
    await expect(spectator.getByTestId("feed-item")).toHaveCount(7);

    // Then the correct word.
    await human.getByTestId("human-input").fill(word);
    await human.getByTestId("human-input").press("Enter");
    await expect(human.getByTestId("human-result")).toHaveAttribute("data-result", "correct");
    await expect(spectator.getByTestId("feed-item")).toHaveCount(8);
    const last = spectator.getByTestId("feed-item").last();
    await expect(last).toHaveAttribute("data-result", "correct");
    await expect(last).toHaveAttribute("data-source", "human");
    await expect(last).toContainText(word);

    // --- Round end overlay with the word and the winner ----------------------
    await expect(spectator.getByTestId("round-overlay")).toBeVisible();
    await expect(spectator.getByTestId("overlay-word")).toHaveText(word);
    await expect(spectator.getByTestId("overlay-reason")).toContainText(nextDrawer.name);
    await expect(spectator.getByTestId("overlay-reason")).toContainText("human assist");
    await expect(spectator.getByTestId("phase")).toHaveText(/reveal/);
    await expect(spectator.getByTestId("word")).toHaveText(word);
    // Scores: drawer +5, the human's team +5 (human assist).
    const drawerRow = spectator.locator(`[data-testid=player-row][data-agent="${drawer.agentId}"]`);
    const teamRow = spectator.locator(
      `[data-testid=player-row][data-agent="${nextDrawer.agentId}"]`,
    );
    await expect(drawerRow.getByTestId("points")).toContainText("5");
    await expect(teamRow.getByTestId("points")).toContainText("5");
    await expect(teamRow.locator(".delta")).toHaveText("+5");
    await expect(human.getByTestId("human-input")).toBeDisabled();
    await spectator.screenshot({ path: `${SHOTS}/reveal.png` });

    // --- Round 2: the human's agent draws; note needs an entitlement ---------
    await expect(spectator.getByTestId("phase")).toHaveText(/choosing/, { timeout: 20_000 });
    await expect(spectator.getByTestId("drawer-name")).toContainText(nextDrawer.name);
    await expect(spectator.getByTestId("feed-item")).toHaveCount(0);
    await expect(spectator.getByTestId("canvas")).toHaveAttribute("data-ops", "0");
    await expect(human.getByTestId("note-input")).toBeVisible();
    await human.getByTestId("note-input").fill("draw something round");
    await human.getByTestId("note-submit").click();
    await expect(human.getByTestId("note-result")).toContainText(/entitlement/i);

    // A human that reloads keeps its session (sessionStorage) and its role.
    await human.reload();
    await expect(human.getByTestId("human-panel")).toBeVisible();
    await expect(human.getByTestId("my-agent")).toHaveText(nextDrawer.name);

    await spectator.close();
    await human.close();
  });

  test("unpaired human session is a spectator with no human panel", async ({ page }) => {
    const base = E2E.serverBase;
    const room = await setupRoom(base, 2);
    players = room.players;
    const code = room.room.code;
    // Join as spectator through the UI, then confirm no team panel exists.
    await joinAsSpectator(page, code);
    await expect(page.getByTestId("human-panel")).toHaveCount(0);
    // A human session without a pair code (REST) also sees no team panel.
    const s = await createSession(base, code, "human");
    const ws = await WsClient.connect(s.wsUrl, "anon-human");
    extraSockets.push(ws);
    const snap = await ws.any("room.state");
    expect(snap.payload.you.role).toBe("human");
    expect(snap.payload.you.agentId).toBeUndefined();
  });
});

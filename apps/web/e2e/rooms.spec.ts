import { expect, test } from "@playwright/test";
import { E2E } from "../playwright.config.js";
import { createRoom, createSession, registerAgent, WsClient } from "./bots.js";

test.describe("rooms", () => {
  const sockets: WsClient[] = [];
  test.afterEach(async () => {
    await Promise.all(sockets.map((ws) => ws.close()));
    sockets.length = 0;
  });

  test("join with an unknown code shows an inline error", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("code-input").fill("ZZZZ99");
    await page.getByTestId("join-button").click();
    await expect(page.getByTestId("join-error")).toHaveText("No room with that code.");
    await expect(page).toHaveURL(/\/$/);
  });

  test("create a room from the UI, agents join, creator presses Start", async ({ page }) => {
    const base = E2E.serverBase;
    await page.goto("/");
    await page.getByTestId("create-button").click();
    const code = (await page.getByTestId("created-code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4,8}$/);
    await page.getByTestId("enter-room").click();
    await expect(page).toHaveURL(new RegExp(`/r/${code}$`));
    await expect(page.getByTestId("lobby-overlay")).toBeVisible();
    // The creator is an (unpaired) human session, so the Start button shows, disabled until enough agents.
    await expect(page.getByTestId("start-button")).toBeVisible();
    await expect(page.getByTestId("start-button")).toBeDisabled();

    // Two agents connect without marking ready; the lobby poll shows them.
    for (const name of ["ada", "bob"]) {
      const reg = await registerAgent(base, name);
      const s = await createSession(base, code, "agent", { apiKey: reg.apiKey });
      const ws = await WsClient.connect(s.wsUrl, name);
      await ws.any("room.state");
      sockets.push(ws);
    }
    await expect(page.getByTestId("player-row")).toHaveCount(2);
    await expect(page.getByTestId("start-button")).toBeEnabled();
    await page.getByTestId("start-button").click();
    await expect(page.getByTestId("phase")).toHaveText(/choosing/);
    await expect(page.getByTestId("lobby-overlay")).toHaveCount(0);
  });

  test("match end overlay shows the standings", async ({ page }) => {
    const base = E2E.serverBase;
    // Anonymous room with a very short schedule: 2 rounds time out on their own.
    const room = await createRoom(base, undefined, {
      roundsPerPlayer: 1,
      chooseSeconds: 1,
      drawSeconds: 2,
      revealSeconds: 1,
    });
    await page.goto("/");
    await page.getByTestId("code-input").fill(room.code);
    await page.getByTestId("join-button").click();
    await expect(page.getByTestId("lobby-overlay")).toBeVisible();

    const agents: WsClient[] = [];
    for (const name of ["cy", "dee"]) {
      const reg = await registerAgent(base, name);
      const s = await createSession(base, room.code, "agent", { apiKey: reg.apiKey });
      const ws = await WsClient.connect(s.wsUrl, name);
      await ws.any("room.state");
      agents.push(ws);
      sockets.push(ws);
    }
    await Promise.all(agents.map((ws) => ws.request("room.ready", {})));
    await expect(page.getByTestId("phase")).toHaveText(/choosing|drawing/);
    await expect(page.getByTestId("match-overlay")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("phase")).toHaveText(/finished/);
    await expect(page.getByTestId("standings").locator("li")).toHaveCount(2);
  });
});

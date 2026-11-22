import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "../functional/fixture.mjs";
import { returnAfter } from "./page-visibility.mjs";

async function login(page, fixture) {
  const summary = page.waitForResponse((response) => response.url().includes("/rpc/get_my_announcement_summary") && response.ok());
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("Password").fill(fixture.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/overview$/);
  await summary;
  await expect(page.locator("html")).toHaveAttribute("data-page-refresh", "");
}

function isServerAction(request) {
  return request.method() === "POST" && Boolean(request.headers()["next-action"]);
}

function rename(fixture, name) {
  return fixture.admin.from("fantasy_teams").update({ name }).eq("id", fixture.teamId);
}

test.describe("mobile pull", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("pull starts at the top, refreshes once on release and keeps data on failure", async ({ page, context }, testInfo) => {
    const f = await createFixture();
    const announcement = randomUUID();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let unblock;
    try {
      checked(await save(f, squad(f.players)), "Save refresh test squad");
      await login(page, f);
      const client = await context.newCDPSession(page);
      const touch = async (type, x, y) => client.send("Input.dispatchTouchEvent", {
        type, touchPoints: type === "touchEnd" ? [] : [{ id: 1, x, y }],
      });
      const release = () => touch("touchEnd");
      const start = () => touch("touchStart", 80, 165);
      const move = (x, y) => touch("touchMove", x, y);
      const indicator = page.locator("[data-page-refresh-indicator]");
      const documentStart = await page.evaluate(() => performance.timeOrigin);
      let requests = 0;
      let summaries = 0;
      let offline = false;
      page.on("request", (request) => {
        if (request.url().includes("/rpc/get_my_announcement_summary")) ++summaries;
      });
      await page.route("**/dashboard/overview", async (route) => {
        if (!isServerAction(route.request())) return route.continue();
        ++requests;
        if (offline) return route.abort("failed");
        await new Promise((resolve) => { unblock = resolve; });
        return route.continue();
      });

      await page.setViewportSize({ width: 390, height: 480 });
      await page.evaluate(() => window.scrollTo(0, 120));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await start();
      await move(80, 280);
      await release();
      await expect(indicator).toHaveCount(0);
      expect(requests).toBe(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

      await start();
      await move(185, 179);
      await release();
      await expect(indicator).toHaveCount(0);
      expect(requests).toBe(0);
      await start();
      await move(80, 210);
      await expect(indicator).toHaveAttribute("data-page-refresh-indicator", "pulling");
      await release();
      await expect(indicator).toHaveCount(0);
      expect(requests).toBe(0);

      checked(await rename(f, "Refreshed Home team"), "Update team behind the open page");
      checked(await f.admin.from("announcements").insert({ id: announcement, title: "Refresh inbox update", body: "New inbox content", published: true, popup_enabled: false }), "Publish inbox update");
      await start();
      await move(80, 266);
      await expect(indicator).toHaveAttribute("data-page-refresh-indicator", "ready");
      expect(requests).toBe(0);
      await page.screenshot({ path: testInfo.outputPath("home-refresh-pull-ready-390.png") });
      await release();
      await expect(page.getByText("Refreshing page…", { exact: true })).toBeAttached();
      await expect.poll(() => requests).toBe(1);
      await page.screenshot({ path: testInfo.outputPath("home-refresh-loading-390.png") });
      await returnAfter(page, 30_000);
      expect(requests).toBe(1);
      unblock();
      await expect(page.getByRole("heading", { name: "Refreshed Home team", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open announcements (1 unread)" })).toBeVisible();
      await expect(indicator).toHaveCount(0);
      expect(summaries).toBe(1);

      offline = true;
      await start();
      await move(80, 266);
      await release();
      await expect(page.getByText("Couldn’t refresh", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("home-refresh-failure-390.png") });
      await expect(page.getByRole("heading", { name: "Refreshed Home team", exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
      expect(errors).toEqual([]);
    } finally {
      unblock?.();
      checked(await f.admin.from("announcements").delete().eq("id", announcement), "Remove refresh announcement");
      await cleanupFixture(f);
    }
  });
});

test("return refreshes the active round and league search while keeping a Squad draft", async ({ page }, testInfo) => {
  const f = await createFixture({ gameweeks: 2 });
  try {
    checked(await save(f, squad(f.players)), "Save return test squad");
    await login(page, f);
    const documentStart = await page.evaluate(() => performance.timeOrigin);
    const nav = page.getByRole("navigation", { name: "Dashboard" });
    let refreshes = 0;
    page.on("request", (request) => { if (isServerAction(request)) ++refreshes; });
    await nav.getByRole("link", { name: "Squad", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("button", { name: "Open actions for Functional Player2" }).click();
    await page.getByRole("button", { name: "Make Functional Player2 captain" }).click();
    const saveButton = page.getByRole("button", { name: "Save team", exact: true });
    await expect(saveButton).toBeEnabled();
    await page.getByRole("button", { name: "Result mode" }).click();
    checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - 5 * 60_000).toISOString() }).eq("id", f.weeks[0].id), "Start the current gameweek");
    await lock(f);
    const match = await addMatch(f);
    await addResult(f, match, { home: [f.players[0]], away: [f.players[2]] });
    await returnAfter(page, 29_999);
    expect(refreshes).toBe(0);
    await expect(saveButton).toBeEnabled();

    await returnAfter(page, 30_000);
    await expect(page.getByText("Transfers closed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Transfer window closed/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Result mode" })).toHaveAttribute("aria-pressed", "true");
    expect(refreshes).toBe(1);

    await complete(f);
    await returnAfter(page, 35_000);
    await expect(page.getByLabel("Result gameweeks")).toContainText("23 pts");
    await page.getByRole("button", { name: "Transfer mode" }).click();
    await expect(saveButton).toBeEnabled();
    await page.getByRole("button", { name: "Open actions for Functional Player2" }).click();
    await expect(page.getByRole("button", { name: "Functional Player2 is already captain" })).toBeDisabled();
    const captain = checked(await f.admin.from("fantasy_team_players").select("player_id").eq("fantasy_team_id", f.teamId).eq("is_captain", true).single(), "Read persisted captain");
    expect(captain.player_id).toBe(f.players[0].id);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Discard changes" }).click();

    await nav.getByRole("link", { name: "Leagues", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/leagues$/);
    await page.getByRole("link", { name: "Gameweek", exact: true }).click();
    await expect(page.getByRole("columnheader", { name: "Gameweek points" })).toBeVisible();
    const search = page.getByRole("searchbox", { name: "Search team name" });
    const searchResponse = page.waitForResponse((response) => response.url().includes("/api/leaderboard?") &&
      new URL(response.url()).searchParams.get("search") === "Functional" && response.ok());
    await search.fill("Functional");
    await searchResponse;
    await expect(page.getByRole("button", { name: `Functional ${f.id}` })).toBeVisible();
    expect(refreshes).toBe(2);
    const selectedUrl = page.url();
    checked(await f.admin.from("profiles").update({ display_name: "Refreshed league manager" }).eq("id", f.userId), "Update manager name behind the search result");
    await returnAfter(page, 30_000);
    await expect(page.getByRole("row", { name: /Refreshed league manager/ })).toBeVisible();
    await expect(search).toHaveValue("Functional");
    await expect(page.getByRole("link", { name: "Gameweek", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(selectedUrl);
    expect(refreshes).toBe(3);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(nav).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("leagues-return-refresh-search-1440.png") });
  } finally {
    await cleanupFixture(f);
  }
});

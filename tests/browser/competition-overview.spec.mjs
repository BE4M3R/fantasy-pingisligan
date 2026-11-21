import { expect, test } from "@playwright/test";
import { checked, cleanupFixture, complete, createFixture, lock, save, squad } from "../functional/fixture.mjs";

test("the Competitions tab lists opted-in rounds by lifecycle and keeps unreleased prizes private", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const f = await createFixture({ gameweeks: 5, competitions: true, seasonCompetitions: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  try {
    checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save squad");
    await lock(f);
    await complete(f);
    const winner = "The Unstoppable Ping Pong Champions of Stockholm";
    checked(await f.user.from("fantasy_teams").update({ name: winner }).eq("id", f.teamId), "Name winning team");
    checked(await f.admin.from("competition_publication").update({ competition_winner: f.teamId })
      .eq("gameweek_id", f.weeks[0].id), "Publish winner");
    checked(await f.admin.from("competition_publication").update({ enabled: false })
      .eq("gameweek_id", f.weeks[4].id), "Exclude unselected round");
    checked(await f.admin.from("homepage_banners").insert([
      { gameweek_id: f.weeks[0].id, content_ready: true, prize_title: "Training shirt" },
      { gameweek_id: f.weeks[1].id, content_ready: true, prize_title: "Premium training kit", sponsor: "Fantasy Test Partner" },
      { gameweek_id: f.weeks[2].id, content_ready: true, prize_title: "Summer training voucher",
        prize_reveal_at: new Date(Date.now() - 60_000).toISOString() },
      { gameweek_id: f.weeks[3].id, content_ready: true, title: "Embargoed title", prize_title: "Embargoed prize",
        sponsor: "Embargoed sponsor", teaser: "A surprise for our next champion", prize_reveal_at: "2099-11-19T17:00:00Z" },
    ], { defaultToNull: false }), "Prepare visible and scheduled prizes");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/competitions");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "Game rules", exact: true })).toBeVisible();
    await page.goto("/login");
    await page.getByLabel("Email").fill(f.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    const nav = page.getByRole("navigation", { name: "Dashboard", exact: true });
    await expect(nav.getByRole("link")).toHaveText(["Home", "Squad", "Competitions", "Leagues", "Fixtures"]);
    await nav.getByRole("link", { name: "Competitions", exact: true }).click();
    await expect(page).toHaveURL(/\/competitions$/);
    await expect(nav.getByRole("link", { name: "Competitions", exact: true })).toHaveAttribute("aria-current", "page");
    const current = page.getByRole("region", { name: "Current Gameweek Competition" });
    const upcoming = page.getByRole("region", { name: "Upcoming Competitions" });
    const previous = page.getByRole("region", { name: "Previous Competitions & Winners" });
    await expect(current.getByRole("heading", { name: "Gameweek 2 Competition" })).toBeVisible();
    await expect(current.getByText("Open", { exact: true })).toBeVisible();
    await expect(current.getByText("Premium training kit", { exact: true })).toBeVisible();
    await expect(current.getByText("Fantasy Test Partner", { exact: true })).toBeVisible();
    await expect(current.getByRole("link", { name: /View competition/ })).toHaveAttribute("href", "/competitions/gameweek/2");
    await expect(upcoming.getByRole("heading", { level: 3 })).toHaveText(["Gameweek 3 Competition", "Gameweek 4 Competition"]);
    await expect(upcoming.getByText("Summer training voucher", { exact: true })).toBeVisible();
    await expect(upcoming.getByText("A surprise for our next champion", { exact: true })).toBeVisible();
    await expect(upcoming.locator("time")).toHaveText("Thu 19 Nov · 18:00");
    await expect(upcoming.getByRole("link")).toHaveCount(1);
    await expect(previous.getByText(winner, { exact: false })).toBeVisible();
    await expect(page.getByRole("region", { name: "Season Competition", exact: true }).getByRole("link")).toHaveAttribute("href", "/competitions/season");
    expect(await page.content()).not.toContain("Embargoed");

    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath("competitions-overview-mobile-390.png") });
    const standingsLink = previous.getByRole("link", { name: /View standings/ });
    await standingsLink.scrollIntoViewIfNeeded();
    await expect(standingsLink).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("competitions-history-mobile-390.png") });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByLabel("Open settings", { exact: true }).click();
    const rules = page.getByRole("link", { name: "Rules", exact: true });
    await expect(rules).toHaveAttribute("href", "/rules");
    await page.screenshot({ path: testInfo.outputPath("competitions-settings-mobile-390.png") });
    await rules.click();
    await expect(page).toHaveURL(/\/rules$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/competitions$/);

    for (const width of [320, 639, 640, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const labels = page.locator('nav[aria-label="Dashboard"] a span');
      expect(await labels.evaluateAll((elements) => elements.every((el) => {
        const label = el.getBoundingClientRect();
        const tab = el.parentElement.getBoundingClientRect();
        return label.left >= tab.left && label.right <= tab.right;
      }))).toBe(true);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath("competitions-overview-desktop-1440.png"), fullPage: true });

    await standingsLink.click();
    await expect(page).toHaveURL(/\/competitions\/gameweek\/1#standings-heading$/);
    await expect(page.getByRole("heading", { name: "Competition leaderboard" })).toBeInViewport();
    await page.getByRole("link", { name: "Back to Competitions", exact: true }).click();
    await expect(page).toHaveURL(/\/competitions$/);

    checked(await f.admin.from("homepage_banners").update({ prize_reveal_at: "2099-11-19T17:00:00Z" })
      .in("gameweek_id", [f.weeks[0].id, f.weeks[1].id]), "Delay the current and completed prizes");
    await page.reload();
    await expect(current.getByRole("heading", { name: "Gameweek 2 Competition" })).toBeVisible();
    await expect(current.getByRole("link", { name: /View competition/ })).toHaveAttribute("href", "/competitions/gameweek/2");
    await expect(previous.getByRole("heading", { name: "Gameweek 1 Competition" })).toBeVisible();
    await expect(previous.getByText(winner, { exact: false })).toBeVisible();
    await expect(current.getByText("Premium training kit", { exact: true })).toHaveCount(0);
    await expect(previous.getByText("Training shirt", { exact: true })).toHaveCount(0);

    checked(await f.admin.from("competition_publication").update({ enabled: false }).eq("id", "global"), "Withdraw competitions");
    await page.reload();
    await expect(page.getByText("Competitions are currently unavailable.", { exact: true })).toBeVisible();
    await expect(current).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await cleanupFixture(f);
  }
});

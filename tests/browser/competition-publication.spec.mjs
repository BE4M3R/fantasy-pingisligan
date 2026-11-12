import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { checked, cleanupFixture, createFixture } from "../functional/fixture.mjs";

test("competitions stay unpublished through links, direct URLs, metadata and APIs until explicitly enabled", async ({ page }, testInfo) => {
  const f = await createFixture({ gameweeks: 2, prizeGameweeks: true });
  const seasonId = randomUUID();
  const rulesId = randomUUID();
  try {
    checked(await f.admin.from("competition_rules").insert({ id: rulesId, kind: "gameweek", version: 1,
      title: "Hidden draft", body: "PRIVATE_RULES_SECRET" }), "Prepare hidden rules");
    checked(await f.admin.from("homepage_banners").insert([
      { gameweek_id: f.weeks[0].id, content_ready: true, title: "PRIVATE_PRIZE_SECRET", prize_title: "Private training kit" },
      { id: seasonId, kind: "season", published: true, title: "PRIVATE_SEASON_SECRET" },
    ], { defaultToNull: false }), "Prepare ready content with feature off");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en");
    await expect(page.getByRole("region", { name: "Competitions", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href^="/competitions/"]')).toHaveCount(0);
    expect(await page.content()).not.toContain("PRIVATE_");
    await page.screenshot({ path: testInfo.outputPath("unpublished-homepage-mobile-390.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("unpublished-homepage-desktop-1440.png"), fullPage: true });
    for (const route of ["/competitions/gameweek/1", `/competitions/gameweek/${f.weeks[0].id}`, "/competitions/season"]) {
      expect((await page.goto(route)).status()).toBe(404);
      expect(await page.content()).not.toContain("PRIVATE_");
      expect((await page.locator('meta[name="robots"]').evaluateAll((elements) => elements.map((el) => el.content))).join(" ")).toContain("noindex");
    }
    const endpoint = `/api/competitions/gameweek/${f.weeks[0].id}/standings`;
    expect((await page.request.get(endpoint)).status()).toBe(404);
    expect((await page.request.get(`/api/leaderboard?gameweek=${f.weeks[0].id}`)).status()).toBe(401);
    expect(await (await page.request.get("/robots.txt")).text()).toContain("Disallow: /competitions");
    expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain("/competitions");
    await page.goto("/login");
    await page.getByLabel("Email").fill(f.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard/overview");
    await expect(page.getByRole("region", { name: "Gameweek highlights" })).toHaveCount(0);
    await expect(page.locator('a[href^="/competitions/"]')).toHaveCount(0);
    await page.goto("/dashboard/leagues?view=gameweek");
    await expect(page.getByRole("navigation", { name: "Standings view" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Global league", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Standings Gameweeks" }).getByText("Gameweek 1", { exact: true })).toBeVisible();
    await expect(page.getByText(/This Gameweek has not started/)).toBeVisible();
    await expect(page.locator('a[href^="/competitions/"]')).toHaveCount(0);
    expect((await page.request.get(`/api/leaderboard?gameweek=${f.weeks[0].id}`)).status()).toBe(200);
    await page.getByRole("button", { name: "Next: Gameweek 2" }).click();
    await expect(page.getByRole("navigation", { name: "Standings Gameweeks" }).getByText("Gameweek 2", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Standings view" }).getByRole("link", { name: "Season", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Standings Gameweeks" })).toHaveCount(0);
    await expect(page.getByLabel("Search team name")).toBeVisible();
    expect((await page.goto("/competitions/gameweek/1")).status()).toBe(404);
    checked(await f.admin.from("competition_publication").update({ enabled: true }).eq("id", "global"), "Enable only isolated local preview");
    await page.goto("/competitions/gameweek/1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Private training kit");
    await expect(page.getByRole("link", { name: "Back to Fantasy", exact: true })).toBeVisible();
    expect(await page.content()).not.toContain("PRIVATE_RULES_SECRET");
    await page.goto("/dashboard/overview");
    await expect(page.getByRole("region", { name: "Gameweek highlights" })).toBeVisible();
    checked(await f.admin.from("competition_publication").update({ enabled: false }).eq("id", "global"), "Withdraw preview");
    expect((await page.goto("/competitions/gameweek/1")).status()).toBe(404);
  } finally {
    checked(await f.admin.from("homepage_banners").delete().eq("id", seasonId), "Remove hidden season");
    checked(await f.admin.from("competition_rules").delete().eq("id", rulesId), "Remove hidden draft");
    await cleanupFixture(f);
  }
});


test("only selected prize rounds have carousel cards, pages and links; Fantasy rounds remain navigable", async ({ page }) => {
  const f = await createFixture({ gameweeks: 5, competitions: true, prizeGameweeks: false });
  try {
    checked(await f.admin.from("competition_publication").update({ enabled: true }).in("gameweek_id", [f.weeks[0].id, f.weeks[2].id, f.weeks[3].id]), "Select prize rounds");
    await page.goto("/login");
    await page.getByLabel("Email").fill(f.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard/overview");
    const carousel = page.getByRole("region", { name: "Gameweek highlights" });
    await expect(carousel.getByRole("button", { name: /^Show highlight/ })).toHaveCount(3);
    await expect(carousel.getByRole("button", { name: /Gameweek 2 Competition/ })).toHaveCount(0);
    await expect(carousel.getByRole("button", { name: /Gameweek 3 Competition/ })).toBeVisible();
    expect((await page.goto("/competitions/gameweek/2")).status()).toBe(404);
    expect((await page.goto(`/competitions/gameweek/${f.weeks[1].id}`)).status()).toBe(404);
    expect((await page.request.get(`/api/competitions/gameweek/${f.weeks[1].id}/standings`)).status()).toBe(404);
    await page.goto(`/dashboard/leagues?view=gameweek&gameweek=${f.weeks[1].id}`);
    await expect(page.getByRole("navigation", { name: "Standings Gameweeks" }).getByText("Gameweek 2", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "View Gameweek 2 Competition →" })).toHaveCount(0);
    await page.getByRole("button", { name: "Previous: Gameweek 1" }).click();
    await expect(page.getByRole("link", { name: "View Gameweek 1 Competition →" })).toHaveCount(0);
    checked(await f.admin.from("competition_publication").update({ enabled: false }).eq("gameweek_id", f.weeks[0].id), "Exclude current prize round");
    expect((await page.goto("/competitions/gameweek/1")).status()).toBe(404);
    await page.goto("/dashboard/overview");
    await expect(carousel.getByRole("button", { name: /^Show highlight/ })).toHaveCount(2);
    await expect(carousel.getByRole("button", { name: /Gameweek 1 Competition/ })).toHaveCount(0);
  } finally { await cleanupFixture(f); }
});

test("weekly-only publication hides season discovery and routes until explicitly opted in", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const f = await createFixture({ competitions: true });
  const seasonId = randomUUID();
  try {
    checked(await f.admin.from("homepage_banners").insert([
      { gameweek_id: f.weeks[0].id, content_ready: true, prize_title: "Weekly training kit" },
      { id: seasonId, kind: "season", published: true, prize_title: "Season training kit" },
    ], { defaultToNull: false }), "Prepare weekly and season prizes");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/en");
      const promotions = page.getByRole("region", { name: "Competitions", exact: true });
      await expect(promotions.getByRole("link")).toHaveCount(1);
      await expect(promotions.getByRole("link")).toHaveAttribute("href", "/competitions/gameweek/1");
      await expect(page.locator('a[href="/competitions/season"]')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 390 || width === 1440)
        await page.screenshot({ path: testInfo.outputPath(`weekly-only-homepage-${width}.png`), fullPage: true });
    }
    expect((await page.goto("/competitions/season")).status()).toBe(404);
    expect((await page.locator('meta[name="robots"]').evaluateAll((els) => els.map((el) => el.content))).join(" ")).toContain("noindex");
    expect(await (await page.request.get("/robots.txt")).text()).toContain("Disallow: /competitions/season");
    expect((await page.goto("/competitions/gameweek/1")).status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Weekly training kit");
    await expect(page).toHaveTitle("Gameweek 1 Competition | Pingisligan Fantasy");
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await expect(page.getByText("Gameweek 1 Competition", { exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: testInfo.outputPath(`gameweek-1-competition-${width}.png`), fullPage: true });
    }
    await page.goto("/login");
    await page.getByLabel("Email").fill(f.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard/overview");
    const carousel = page.getByRole("region", { name: "Gameweek highlights" });
    await expect(carousel).toBeVisible();
    await expect(carousel.getByText("Season Competition", { exact: true })).toHaveCount(0);
    await expect(carousel.getByText("Gameweek 1 Competition", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath("weekly-only-dashboard-390.png"), fullPage: true });
    checked(await f.admin.from("competition_publication").update({ enabled: true }).eq("id", "season"), "Opt season in");
    expect((await page.goto("/competitions/season")).status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Season training kit");
    checked(await f.admin.from("competition_publication").update({ enabled: false }).eq("id", "season"), "Withdraw season again");
    expect((await page.goto("/competitions/season")).status()).toBe(404);
    await page.goto("/dashboard/leagues?view=season");
    await expect(page.getByLabel("Search team name")).toBeVisible();
  } finally {
    checked(await f.admin.from("homepage_banners").delete().eq("id", seasonId), "Remove season prize");
    await cleanupFixture(f);
  }
});

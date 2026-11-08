import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { checked, cleanupFixture, createFixture } from "../functional/fixture.mjs";

test("competitions stay unpublished through links, direct URLs, metadata and APIs until explicitly enabled", async ({ page }, testInfo) => {
  const f = await createFixture();
  const seasonId = randomUUID();
  const rulesId = randomUUID();
  try {
    checked(await f.admin.from("competition_rules").insert({ id: rulesId, kind: "gameweek", version: 1,
      title: "Hidden draft", body: "PRIVATE_RULES_SECRET" }), "Prepare hidden rules");
    checked(await f.admin.from("homepage_banners").insert([
      { gameweek_id: f.weeks[0].id, content_ready: true, title: "PRIVATE_PRIZE_SECRET", cta_label: "Private training kit" },
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
    await expect(page.getByRole("navigation", { name: "Standings view" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Global league", exact: true })).toBeVisible();
    await expect(page.getByLabel("Search team name")).toBeVisible();
    expect((await page.request.get(`/api/leaderboard?gameweek=${f.weeks[0].id}`)).status()).toBe(404);
    expect((await page.goto("/competitions/gameweek/1")).status()).toBe(404);
    checked(await f.admin.from("competition_publication").update({ enabled: true }).eq("id", true), "Enable only isolated local preview");
    await page.goto("/competitions/gameweek/1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Private training kit");
    await expect(page.getByRole("link", { name: "Back to Fantasy", exact: true })).toBeVisible();
    expect(await page.content()).not.toContain("PRIVATE_RULES_SECRET");
    await page.goto("/dashboard/overview");
    await expect(page.getByRole("region", { name: "Gameweek highlights" })).toBeVisible();
    checked(await f.admin.from("competition_publication").update({ enabled: false }).eq("id", true), "Withdraw preview");
    expect((await page.goto("/competitions/gameweek/1")).status()).toBe(404);
  } finally {
    checked(await f.admin.from("homepage_banners").delete().eq("id", seasonId), "Remove hidden season");
    checked(await f.admin.from("competition_rules").delete().eq("id", rulesId), "Remove hidden draft");
    await cleanupFixture(f);
  }
});

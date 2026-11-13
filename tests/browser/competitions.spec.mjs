import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "../functional/fixture.mjs";

test("shared competition page protects drafts and supports top-five search, prize links, terms and dashboard return", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const f = await createFixture({ gameweeks: 3, competitions: true, seasonCompetitions: true });
  const seasonId = randomUUID();
  const competitors = [];
  const paths = [`${f.id}/competition-logo.png`, `${f.id}/competition-prize.png`];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const players = [f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]];
    checked(await save(f, squad(players)), "Save competition squad");
    for (let i = 1; i <= 6; i++) {
      const email = `${randomUUID()}@example.invalid`;
      const user = checked(await f.admin.auth.admin.createUser({ email, password: f.password, email_confirm: true }), "Create competitor").user;
      competitors.push(user.id);
      checked(await f.admin.from("fantasy_teams").insert({ user_id: user.id, name: `Competition team 0${i}`,
        onboarding_completed: true, created_at: new Date(Date.now() - 3600000).toISOString() }), "Create competitor team");
      // Each competitor saves through the normal authenticated squad function.
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(f.url, f.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      checked(await client.auth.signInWithPassword({ email, password: f.password }), "Sign in competitor");
      checked(await save({ ...f, user: client }, squad(players)), "Save competitor squad");
    }
    await lock(f);
    const game = await addMatch(f);
    await addResult(f, game, { home: [f.players[0]], away: [f.players[2]] });
    checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - 60000).toISOString() }).eq("id", f.weeks[0].id), "Reach kickoff");
    await complete(f);
    for (const path of paths) checked(await f.admin.storage.from("announcement-artwork").upload(path,
      await readFile(new URL("../../public/branding/pingisligan-fantasy-logo.png", import.meta.url)), { contentType: "image/png" }), "Upload competition artwork");
    checked(await f.admin.from("homepage_banners").insert([
      { gameweek_id: f.weeks[0].id, content_ready: true, sponsor: "Smash Test Partner", prize_title: "The training collection",
        image_path: paths[0], image_alt: "Test sponsor logo", prize_image_path: paths[1], prize_image_alt: "Test prize artwork",
        prize_value_sek: 500, prize_product_url: "https://shop.example.invalid/training-collection",
        prize_description: "A premium **training collection** for your next session.\n\n- Competition shirt\n- Training accessories",
        details_markdown: "Delivery within Sweden.\n\n<script>window.competitionUnsafe = true</script>" },
      { gameweek_id: f.weeks[2].id, content_ready: true, title: "Embargoed title", sponsor: "Embargoed sponsor", prize_description: "Embargoed prize", prize_product_url: "https://shop.example.invalid/embargoed" },
      { id: seasonId, kind: "season", published: true, title: "The Season Competition", prize_title: "Season training kit",
        sponsor: "Season Partner", prize_description: "A season to remember.", prize_image_path: paths[1], prize_image_alt: "Season prize artwork" },
    ], { defaultToNull: false }), "Prepare public competitions");
    const route = "/competitions/gameweek/1";
    const legacy = await page.request.get(`/competitions/gameweek/${f.weeks[0].id}`, { maxRedirects: 0, timeout: 30000 });
    expect(legacy.status()).toBe(308);
    expect(legacy.headers().location).toBe(route);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The training collection");
    await expect(page.getByText("Awaiting winner confirmation", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Provisional", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Competition leaderboard", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Winner announcement", exact: true })).toBeVisible();
    await expect(page.getByText(/Gameweek points including captains/)).toHaveCount(0);
    await expect(page.locator('header img[src*="wordmark-transparent-v2"]')).toBeVisible();
    await expect(page.getByText(/Sponsored by Smash Test Partner/)).toBeVisible();
    await expect(page.getByAltText("Test sponsor logo")).toHaveCount(0);
    await expect(page.getByText(/Approximate value:.*500/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Play Fantasy", exact: true })).toHaveAttribute("href", "/signup");
    await expect(page.locator("tbody tr")).toHaveCount(5);
    const endpoint = `/api/competitions/gameweek/${f.weeks[0].id}/standings`;
    expect((await page.request.get(`${endpoint}?offset=-1`)).status()).toBe(400);
    expect((await page.request.get(`${endpoint}?search=${"a".repeat(81)}`)).status()).toBe(400);
    expect((await page.request.get(`/api/leaderboard?gameweek=${f.weeks[0].id}`)).status()).toBe(401);
    const publicRows = await page.locator("tbody").innerText();
    const product = page.getByRole("link", { name: /View product/ });
    await expect(product).toHaveAttribute("href", "https://shop.example.invalid/training-collection");
    await expect(product).toHaveAttribute("target", "_blank");
    await expect(product).toHaveAttribute("rel", "noopener noreferrer");
    await page.context().route("https://shop.example.invalid/**", (request) => request.fulfill({ body: "Test sponsor product" }));
    const popupPromise = page.waitForEvent("popup");
    await product.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL("https://shop.example.invalid/training-collection");
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    await expect.poll(() => page.getByAltText("Test prize artwork").evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    expect(await page.getByAltText("Test prize artwork").evaluate((img) => img.getBoundingClientRect().height)).toBeLessThanOrEqual(176);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath("competition-completed-mobile-390.png"), fullPage: true });
    for (const width of [320, 390, 639, 640, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator("td").evaluateAll((elements) => elements.every((el) => el.scrollWidth <= el.clientWidth))).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath("competition-completed-desktop-1440.png"), fullPage: true });
    await page.getByRole("button", { name: "Show more teams" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(7);
    await page.route("**/api/competitions/**/standings?*", (request) => request.fulfill({ status: 503, json: { error: "Temporary test failure" } }), { times: 1 });
    await page.getByLabel("Search team name").fill("COMPETITION TEAM 06");
    await expect(page.getByRole("alert").filter({ hasText: "leaderboard could not be loaded" })).toBeVisible();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.getByRole("cell", { name: "Competition team 06", exact: true })).toBeVisible();
    await expect(page.locator("tbody td").first()).toHaveText("1");
    await page.getByLabel("Search team name").fill("no such team");
    await expect(page.getByText("No teams found.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear team search" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(7);
    await expect(page.getByRole("link", { name: "Competition rules and policy" })).toHaveAttribute("href", "/rules#competition-rules");
    await page.getByRole("link", { name: "Competition rules and policy" }).click();
    await expect(page).toHaveURL(/\/rules#competition-rules$/);
    await expect(page.getByRole("heading", { name: "Competition rules and policy", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prize-specific information" })).toHaveCount(0);
    await expect(page.getByText("Delivery within Sweden.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Rules and practical information" })).toHaveCount(0);
    expect(await page.evaluate(() => window.competitionUnsafe)).toBeUndefined();
    await page.goBack();
    await expect(page).toHaveURL(/\/competitions\/gameweek\/1$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${route}$`));
    await page.goto(`/competitions/gameweek/${f.weeks[2].id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Prize details coming soon");
    expect(await page.content()).not.toContain("Embargoed");
    await expect(page.getByText(/This Gameweek has not started/)).toBeVisible();
    await expect(page.getByLabel("Search team name")).toBeDisabled();
    await page.goto("/competitions/season");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Season training kit");
    await expect(page.getByRole("heading", { name: "Season winner" })).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /View product/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Competition rules and policy" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("competition-season-mobile-390.png"), fullPage: true });
    expect((await page.context().cookies()).filter((cookie) => cookie.name.includes("auth-token"))).toEqual([]);
    // Same shared content, now reached using real Next navigation from Home.
    await page.goto("/login");
    await page.getByLabel("Email").fill(f.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard/overview");
    const carousel = page.getByRole("region", { name: "Gameweek highlights" });
    await carousel.getByRole("button", { name: /Show highlight 1:/ }).click();
    const competitionLink = carousel.getByRole("link", { name: /View competition/ });
    await expect(competitionLink).toHaveAttribute("href", route);
    await competitionLink.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    await competitionLink.click();
    await expect(page.getByRole("link", { name: "Back to Fantasy", exact: true })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(5);
    expect(await page.locator("tbody").innerText()).toBe(publicRows);
    await page.getByRole("link", { name: "Back to Fantasy", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/overview$/);
    await expect.poll(() => page.evaluate((expected) => Math.abs(scrollY - expected), scroll)).toBeLessThan(4);
    await page.goto(route);
    await page.getByRole("link", { name: "Back to Fantasy", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/overview$/);
    expect(errors).toEqual([]);
    expect((await page.goto("/competitions/gameweek/invalid"))?.status()).toBe(404);
  } finally {
    for (const id of competitors) checked(await f.admin.auth.admin.deleteUser(id), "Remove competitor");
    checked(await f.admin.storage.from("announcement-artwork").remove(paths), "Remove competition artwork");
    checked(await f.admin.from("homepage_banners").delete().eq("id", seasonId), "Remove season competition");
    await cleanupFixture(f);
  }
});

test("public homepage promotes two competitions and approved shared terms remain accessible in the compact page", async ({ page }, testInfo) => {
  const f = await createFixture({ gameweeks: 3, competitions: true, seasonCompetitions: true });
  const seasonId = randomUUID();
  const rulesId = randomUUID();
  const seasonRulesId = randomUUID();
  const version = randomInt(100000, 1900000000);
  try {
    checked(await f.admin.from("competition_rules").insert({ id: rulesId, kind: "gameweek", version,
      title: "Gameweek competition test terms", body: "## Participation\n\nFree automatic participation with a valid locked squad.\n\nFollow the [Fantasy scoring rules](/rules).\n\n## How the winner is selected\n\nSynthetic scoring terms.\n\n## Winner announcement & claiming\n\n**Claiming and delivery:** contact the organiser. These are test terms.\n\n<script>window.unsafeTerms = true</script>\n\n## Prize delivery\n\nSynthetic delivery terms.\n\n## Taxation\n\nCheck the applicable tax rules.",
      approved_at: new Date().toISOString() }), "Approve synthetic test terms");
    checked(await f.admin.from("competition_rules").insert({ id: seasonRulesId, kind: "season", version,
      title: "Season competition test terms", body: "## Participation\n\nSeason participation terms." }), "Prepare synthetic season draft");
    checked(await f.admin.from("homepage_banners").insert([
      { gameweek_id: f.weeks[0].id, content_ready: true, sponsor: "Current test partner", prize_title: "Training bag",
        prize_description: "A **training bag** for your next session.", prize_value_sek: 500 },
      { gameweek_id: f.weeks[1].id, content_ready: true, sponsor: "Unrevealed weekly partner", prize_title: "Unrevealed weekly prize" },
      { id: seasonId, kind: "season", published: true, publish_at: new Date(Date.now() + 3600000).toISOString(),
        sponsor: "Unrevealed season partner", prize_value_sek: 16000, prize_title: "Table tennis table" },
    ], { defaultToNull: false }), "Prepare landing promotions");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en");
    const promotions = page.getByRole("region", { name: "Competitions", exact: true });
    await expect(promotions.getByRole("link")).toHaveCount(2);
    await expect(promotions.getByRole("heading", { name: "Training bag", exact: true })).toBeVisible();
    await expect(promotions.getByRole("heading", { name: "Compete for exciting Gameweek prizes", exact: true })).toBeVisible();
    await expect(promotions.locator("img")).toHaveCount(0);
    await expect(promotions.getByText("Current test partner", { exact: true })).toHaveCount(0);
    await expect(page.getByAltText("Yasaka", { exact: true })).toBeVisible();
    await expect(promotions.getByText("View competition", { exact: true })).toHaveCount(2);
    expect(await page.content()).not.toContain("Unrevealed");
    await expect(page.getByRole("link", { name: "Get started", exact: true })).toBeVisible();
    await expect(page.locator(".sponsored-track")).toHaveCount(0);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: testInfo.outputPath("public-promotions-desktop-1440.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: testInfo.outputPath("public-promotions-mobile-390.png"), fullPage: true });
    await promotions.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/competitions\/gameweek\/1$/);
    await expect(page.locator("main > div > section")).toHaveCount(2);
    await page.getByRole("link", { name: "Competition rules and policy" }).click();
    await expect(page).toHaveURL(/\/rules#competition-rules$/);
    const accordions = page.locator('#competition-rules details');
    await expect(accordions).toHaveCount(4);
    await expect(page.locator('#competition-rules details[open]')).toHaveCount(0);
    await expect(page.locator("#competition-rules").getByRole("heading", { name: "Season competition" })).toHaveCount(0);
    await expect(page.getByText("Claiming and delivery:", { exact: true })).not.toBeVisible();
    await page.getByText("Participation", { exact: true }).click();
    await page.getByText("Winner Announcement & Claiming", { exact: true }).click();
    await expect(page.locator('#competition-rules details[open]')).toHaveCount(2);
    await expect(page.getByText(new RegExp(`Version ${version}`))).toHaveCount(0);
    await expect(page.getByText("Claiming and delivery:", { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic delivery terms.", { exact: true })).toBeVisible();
    await expect(page.getByText("Prize Delivery", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Fantasy scoring rules", exact: true })).toHaveAttribute("href", "/rules");
    const participation = page.locator('#competition-rules summary').filter({ hasText: "Participation" });
    await participation.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('#competition-rules details[open]')).toHaveCount(1);
    await expect(page.getByText("Claiming and delivery:", { exact: true })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(page.locator('#competition-rules details[open]')).toHaveCount(2);
    expect(await page.evaluate(() => window.unsafeTerms)).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath("competition-approved-terms-mobile-390.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("competition-approved-terms-desktop-1440.png"), fullPage: true });
    checked(await f.admin.from("homepage_banners").update({ publish_at: new Date(Date.now() - 60000).toISOString() }).eq("id", seasonId), "Reveal season prize");
    checked(await f.admin.from("competition_rules").update({ approved_at: new Date().toISOString() }).eq("id", seasonRulesId), "Publish shared season policy");
    await page.reload();
    await expect(page.locator("#competition-rules").getByRole("heading", { name: "Season competition" })).toBeVisible();
    await page.locator('#competition-rules section[aria-label^="Season competition rules"] summary').click();
    await expect(page.getByText("Season participation terms.", { exact: true })).toBeVisible();
    await page.goto("/en");
    await expect(promotions.getByRole("heading", { name: "Table tennis table", exact: true })).toBeVisible();
    await expect(promotions.getByText(/16,000/)).toBeVisible();
    await promotions.getByRole("link").last().click();
    await expect(page).toHaveURL(/\/competitions\/season$/);
    await expect(page.getByRole("heading", { name: "Season winner" })).toHaveCount(0);
    await expect(page.getByText(/Approximate value:.*16,000/)).toBeVisible();
    expect(await page.content()).not.toContain("tax-free");
  } finally {
    checked(await f.admin.from("homepage_banners").delete().eq("id", seasonId), "Remove test season promotion");
    await cleanupFixture(f);
    // Approved document text is intentionally immutable. This synthetic version
    // stays in the disposable stack until the runner destroys that stack.
  }
});

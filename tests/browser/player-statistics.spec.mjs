import { expect, test } from "@playwright/test";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "../functional/fixture.mjs";

let fixture;
test.describe.serial("player statistics and transfer comparison", () => {
  test.beforeAll(async () => {
    fixture = await createFixture({ gameweeks: 6 });
    checked(await fixture.admin.from("players").update({ price: 110000000, club_id: fixture.clubs[1].id }).eq("id", fixture.players[9].id), "Create transfer option exceeding both budget and club limit");
    checked(await fixture.admin.from("players").update({ club_id: fixture.clubs[1].id }).eq("id", fixture.players[10].id), "Create club-limited transfer option");
    for (const [index, name] of ["[TEST] Halmstad BTK", "[TEST] Eslövs AI BTK", "[TEST] Söderhamns UIF", "[TEST] Spårvägens BTK"].entries()) {
      checked(await fixture.admin.from("clubs").update({ name }).eq("id", fixture.clubs[index].id), "Name fixture clubs for logo coverage");
      fixture.clubs[index].name = name;
    }
    checked(await save(fixture, squad([fixture.players[0], fixture.players[2], fixture.players[4], fixture.players[6], fixture.players[1], fixture.players[3]])), "Save statistics squad");
    for (const [index, week] of fixture.weeks.slice(0, 5).entries()) {
      await lock(fixture, week);
      const game = await addMatch(fixture, { week, winner: index === 3 ? "away" : "home" });
      const singles = { home: [fixture.players[0]], away: [fixture.players[2]] };
      const doubles = { home: [fixture.players[0], fixture.players[1]], away: [fixture.players[2], fixture.players[3]], order: 7, golden: true };
      if (index === 0) {
        await addResult(fixture, game, { ...singles, homeSets: 3, awaySets: 0 });
        await addResult(fixture, game, { ...singles, order: 2 });
        await addResult(fixture, game, doubles);
      } else if (index === 1) {
        await addResult(fixture, game, { ...singles, homeSets: 3, awaySets: 2 });
        await addResult(fixture, game, { ...singles, homeSets: 1, awaySets: 3, order: 2 });
      } else if (index === 2) {
        await addResult(fixture, game, { home: [fixture.players[1]], away: [fixture.players[3]] });
      } else if (index === 3) {
        await addResult(fixture, game, { ...doubles, homeSets: 1, awaySets: 3 });
      } else {
        await addResult(fixture, game, singles);
      }
      await complete(fixture, week);
      checked(await fixture.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - (6 - index) * 60_000).toISOString() }).eq("id", week.id), "Expose player history");
    }
    for (let index = 0; index < 3; index += 1) {
      const upcoming = await addMatch(fixture, { week: fixture.weeks[5], homeClub: index === 1 ? 2 : 0, awayClub: index === 1 ? 0 : index + 1 });
      checked(await fixture.admin.from("matches").update({ status: "scheduled", starts_at: new Date(Date.now() + (index + 1) * 24 * 60 * 60_000).toISOString(), winning_team_stupa_participant_id: null }).eq("id", upcoming.match.id), "Schedule club fixture");
    }
  });
  test.afterAll(async () => { if (fixture) await cleanupFixture(fixture); });

  async function login(page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard");
    await expect(page.getByLabel("Squad editor")).toBeVisible();
  }
  async function capture(page, testInfo, name) {
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[role="dialog"]').evaluateAll((dialogs) => Promise.all(dialogs.flatMap((dialog) => dialog.getAnimations({ subtree: true })).map((animation) => animation.finished.catch(() => {}))));
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path });
    await testInfo.attach(name, { path, contentType: "image/png" });
  }

  test("statistics endpoints require login and validate player identities", async ({ page }) => {
    test.setTimeout(90_000);
    expect((await page.request.get("/api/players")).status()).toBe(401);
    expect((await page.request.get(`/api/players/${fixture.players[0].id}`)).status()).toBe(401);
    await login(page);
    expect((await page.request.get(`/dashboard/players/${fixture.players[0].id}`)).status()).toBe(404);
    expect((await page.request.get("/api/players/invalid")).status()).toBe(400);
    expect((await page.request.get("/api/players/00000000-0000-0000-0000-000000000000")).status()).toBe(404);
    const stats = await page.request.get(`/api/players/${fixture.players[0].id}`);
    expect(stats.status()).toBe(200);
    const payload = await stats.json();
    expect(payload.history).toHaveLength(5);
    expect(payload.player.owned_percent).toBe(100);
    // Earlier journeys can leave the shared 60-second catalogue cache warm.
    // Wait for the newly created fixture to appear before checking the picker.
    await expect.poll(async () => {
      const response = await page.request.get("/api/players");
      expect(response.status()).toBe(200);
      const catalogue = await response.json();
      return catalogue.players.find((player) => player.id === fixture.players[0].id)?.owned_percent;
    }, { timeout: 75_000, intervals: [500, 1000, 5000] }).toBe(payload.player.owned_percent);
    expect(payload.history[4].singles_wins).toBe(2);
    expect(payload.history[4].doubles_wins).toBe(1);
    expect(payload.fixtures).toHaveLength(3);
    expect(payload.fixtures.every((match) => match.gameweek.round_order === 6)).toBe(true);
    expect(payload.history[1].fantasy_points).toBe(0);
    expect(payload.history[1].doubles_losses).toBe(1);
  });

  test("squad statistics load on demand and retry without blocking player actions", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const statsUrl = `**/api/players/${fixture.players[4].id}`;
    let requests = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route(statsUrl, async (route) => {
      requests += 1;
      await gate;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Could not load player statistics. Please try again." }) });
    });
    await login(page);
    expect(requests).toBe(0);
    await page.getByRole("button", { name: "Open actions for Functional Player4" }).click();
    const actions = page.getByRole("dialog", { name: "Functional Player4", exact: true });
    await expect(actions.getByRole("status")).toContainText("Loading player statistics");
    await expect(actions.getByRole("button", { name: "Transfer player", exact: true })).toBeEnabled();
    await capture(page, testInfo, "squad-player-loading-mobile-390");
    release();
    await expect(actions.getByRole("alert")).toContainText("Could not load player statistics");
    await capture(page, testInfo, "squad-player-error-mobile-390");
    await page.unroute(statsUrl);
    await actions.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(actions.getByRole("heading", { name: "Recent form", exact: true })).toBeVisible();
    await expect(actions.getByRole("list", { name: "Upcoming opponents" }).getByRole("listitem")).toHaveCount(1);
    await actions.getByRole("button", { name: "Close player actions" }).click();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  });

  test("player details preserve transfer filters and draft; layouts remain usable on phones and desktop", async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.getByRole("button", { name: "Open actions for Functional Player0" }).click();
    const actions = page.getByRole("dialog", { name: "Functional Player0", exact: true });
    await expect(actions.getByRole("heading", { name: "Recent form", exact: true })).toBeVisible();
    await expect(actions.getByRole("heading", { name: "Team action", exact: true })).toBeVisible();
    await expect(actions.getByRole("heading", { name: "Player overview", exact: true })).toBeVisible();
    await expect(actions.getByLabel("Player summary").locator(":scope > div")).toHaveCount(3);
    await expect(actions.getByText("Owned %", { exact: true }).first().locator("..")).toContainText("100%");
    await expect(actions.getByRole("list", { name: "Recent gameweek scores" }).getByRole("listitem", { name: "GW 3: did not play", exact: true })).toContainText("-");
    await expect(actions.getByRole("list", { name: "Recent gameweek scores" }).getByRole("listitem", { name: "GW 4: 0 points, played", exact: true })).toContainText("0");
    await expect(actions.getByRole("list", { name: "Upcoming opponents" }).getByRole("listitem")).toHaveCount(3);
    await expect(actions.getByRole("heading", { name: "Singles", exact: true })).toHaveCount(0);
    const actionButtons = actions.getByRole("group", { name: "Player actions", exact: true }).getByRole("button");
    await expect(actionButtons).toHaveText(["Make captain", "Transfer player", "Swap"]);
    const footer = actions.getByRole("group", { name: "Player details and removal", exact: true });
    await expect(footer.getByRole("button")).toHaveText(["Remove player", "Full player statistics"]);
    for (const viewport of [
      { width: 390, height: 844 }, { width: 320, height: 568 },
      { width: 639, height: 844 }, { width: 640, height: 844 },
      { width: 768, height: 1024 }, { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      const boxes = await actionButtons.evaluateAll((buttons) => buttons.map((button) => ({ top: button.getBoundingClientRect().top, overflow: button.scrollWidth > button.clientWidth })));
      expect(boxes.every((box) => Math.abs(box.top - boxes[0].top) < 1 && !box.overflow)).toBe(true);
      expect(await actions.locator(":scope > div").evaluate((panel) => panel.scrollHeight <= panel.clientHeight && panel.scrollWidth <= panel.clientWidth)).toBe(true);
      const removeBox = await footer.getByRole("button", { name: "Remove player", exact: true }).boundingBox();
      const statisticsBox = await footer.getByRole("button", { name: "View statistics for Functional Player0", exact: true }).boundingBox();
      expect(statisticsBox.x).toBeGreaterThan(removeBox.x + removeBox.width);
      expect(Math.abs(statisticsBox.y - removeBox.y)).toBeLessThan(1);
      expect(statisticsBox.width).toBeGreaterThan(removeBox.width * 1.8);
      const upcomingBox = await actions.getByRole("list", { name: "Upcoming opponents" }).boundingBox();
      expect(removeBox.y).toBeGreaterThan(upcomingBox.y + upcomingBox.height);
      await expect(footer.getByRole("button", { name: "Remove player", exact: true })).toBeInViewport();
      await expect(footer.getByRole("button", { name: "View statistics for Functional Player0", exact: true })).toBeInViewport();
      await expect(actions.getByRole("list", { name: "Upcoming opponents" })).toBeInViewport();
      expect(await actions.getByRole("list", { name: "Upcoming opponents" }).getByRole("listitem").last().evaluate((item) => {
        const box = item.getBoundingClientRect();
        return item.contains(document.elementFromPoint(box.x + box.width / 2, box.bottom - 4));
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if ([320, 390, 1440].includes(viewport.width)) await capture(page, testInfo, `squad-player-statistics-${viewport.width}x${viewport.height}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await actions.getByRole("button", { name: "About Form", exact: true }).click();
    const previewInfo = page.getByRole("dialog", { name: "About Form", exact: true });
    await expect(previewInfo).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(previewInfo).not.toBeVisible();
    await expect(actions).toBeVisible();
    await actions.getByRole("button", { name: "Swap", exact: true }).click();
    await expect(actions.getByRole("button", { name: /Functional Player1/ })).toBeVisible();
    await capture(page, testInfo, "squad-player-swap-mobile-390");
    await actions.getByRole("button", { name: "Swap", exact: true }).click();
    let detailRequests = 0;
    page.on("request", (request) => { if (new URL(request.url()).pathname === `/api/players/${fixture.players[0].id}`) detailRequests += 1; });
    await actions.getByRole("button", { name: "View statistics for Functional Player0" }).click();
    const details = page.getByRole("dialog", { name: "Functional Player0 statistics", exact: true });
    await expect(details.getByRole("heading", { name: "Recent form" })).toBeVisible();
    expect(detailRequests).toBe(0);
    await expect(details.getByText("Owned %", { exact: true }).first().locator("..")).toContainText("100%");
    await details.getByRole("button", { name: "About Owned %", exact: true }).click();
    const ownedInfo = page.getByRole("dialog", { name: "About Owned %", exact: true });
    await expect(ownedInfo).toContainText("Percentage of teams that owned this player in the last finished gameweek");
    await capture(page, testInfo, "player-ownership-information-mobile-390");
    await ownedInfo.getByRole("button", { name: "Close information" }).click();
    const scores = details.getByRole("list", { name: "Recent gameweek scores" });
    await expect(scores.getByRole("listitem")).toHaveCount(5);
    await expect(scores.getByRole("listitem", { name: "GW 3: did not play", exact: true }).getByText("-", { exact: true })).toBeVisible();
    await expect(scores.getByRole("listitem", { name: "GW 4: 0 points, played", exact: true })).toContainText("0");
    await expect(details.getByRole("heading", { name: "Singles", exact: true })).toBeVisible();
    await expect(details.getByText("Sets won match", { exact: true }).locator("..")).toContainText("12–4 · 8 pts");
    await expect(details.getByText("Sets lost match", { exact: true }).locator("..")).toContainText("1–3 · 1 pts");
    await expect(details.getByRole("link", { name: /Full player page/ })).toHaveCount(0);
    await expect(details.getByText("Form is average points", { exact: false }).first()).not.toBeVisible();
    await details.getByRole("button", { name: "About Form", exact: true }).click();
    const formInfo = page.getByRole("dialog", { name: "About Form", exact: true });
    await expect(formInfo).toContainText("No recorded appearance counts as zero");
    await capture(page, testInfo, "player-statistics-information-mobile-390");
    await page.keyboard.press("Escape");
    await expect(formInfo).not.toBeVisible();
    await expect(details).toBeVisible();
    await details.getByRole("button", { name: "About Home and away", exact: true }).click();
    const upcomingInfo = page.getByRole("dialog", { name: "About Home and away", exact: true });
    await expect(upcomingInfo).toContainText("H (home) and A (away)");
    await capture(page, testInfo, "player-upcoming-information-mobile-390");
    await upcomingInfo.getByRole("button", { name: "Close information" }).click();
    const upcoming = details.getByRole("list", { name: "Upcoming opponents" }).getByRole("listitem");
    await expect(upcoming.nth(0)).toContainText("GW6 (H)");
    await expect(upcoming.nth(1)).toContainText("GW6 (A)");
    await expect(upcoming.nth(2)).toContainText("GW6 (H)");
    for (const label of ["Player statistics", "Price", "Points", "Pts/GW", "Singles", "Doubles", "gameweek history"]) {
      await expect(details.getByRole("button", { name: `About ${label}`, exact: true })).toHaveCount(0);
    }
    await expect(details.getByText("Final", { exact: true })).toHaveCount(0);
    await expect(details.getByText("Live", { exact: true })).toHaveCount(0);
    await expect(details.getByRole("img", { name: "Halmstad BTK logo" })).toHaveCount(1);
    await expect(details.getByRole("img", { name: "Eslövs AI BTK logo" })).toHaveCount(1);
    await expect(details.getByRole("img", { name: "Söderhamns UIF logo" })).toHaveCount(1);
    await expect(details.getByRole("img", { name: "Spårvägens BTK logo" })).toHaveCount(1);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const summary = details.getByLabel("Player summary");
      const cards = await summary.locator(":scope > div").evaluateAll((elements) => elements.map((element) => ({ top: element.getBoundingClientRect().top, overflow: element.scrollWidth > element.clientWidth })));
      expect(cards).toHaveLength(4);
      expect(cards.every((card) => Math.abs(card.top - cards[0].top) < 1 && !card.overflow)).toBe(true);
      const opponents = await details.getByRole("list", { name: "Upcoming opponents" }).getByRole("listitem").evaluateAll((items) => items.map((item) => ({ top: item.getBoundingClientRect().top, overflow: item.scrollWidth > item.clientWidth })));
      expect(opponents).toHaveLength(3);
      expect(opponents.every((opponent) => Math.abs(opponent.top - opponents[0].top) < 1 && !opponent.overflow)).toBe(true);
      expect((await details.getByRole("region", { name: "Recent form", exact: true }).boundingBox()).height).toBeLessThan(110);
      expect(await details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, testInfo, "player-statistics-mobile-390");
    await details.getByRole("heading", { name: "Gameweek history" }).scrollIntoViewIfNeeded();
    await capture(page, testInfo, "player-statistics-history-mobile-390");
    await page.keyboard.press("Escape");
    await expect(details).not.toBeVisible();
    await expect(actions).toBeVisible();
    await actions.getByRole("button", { name: "Transfer player", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Replace player", exact: true });
    await picker.getByLabel("Search players").fill("Functional");
    const header = (label) => picker.getByRole("columnheader", { name: `Sort by ${label}`, exact: true });
    await expect(picker.getByLabel("Sort players", { exact: true })).toHaveCount(0);
    await expect(header("Price")).toHaveAttribute("aria-sort", "descending");
    await expect(picker.locator("tbody > tr").first()).toContainText("110.0m");
    await picker.getByRole("button", { name: "Sort by Price", exact: true }).click();
    await expect(header("Price")).toHaveAttribute("aria-sort", "ascending");
    await expect(picker.locator("tbody > tr").first()).toContainText("10.0m");
    await expect(header("Form")).toBeVisible();
    await expect(header("Owned %")).toBeVisible();
    const ownedRow = picker.locator("tbody > tr").filter({ has: page.getByRole("button", { name: "View statistics for Functional Player0", exact: true }) });
    await expect(ownedRow).toContainText("100%");
    const outgoing = picker.getByRole("region", { name: "Outgoing player", exact: true });
    await expect(outgoing).toContainText("F. Player0");
    await expect(outgoing).toContainText("PLAYER TO REPLACE");
    await expect(outgoing.getByRole("button", { name: "View Price statistics for Functional Player0", exact: true })).toHaveText(await ownedRow.getByRole("button", { name: "View Price statistics for Functional Player0", exact: true }).innerText());
    await expect(outgoing.getByRole("button", { name: /View (Form|Owned %) statistics/ })).toHaveCount(0);
    expect((await picker.getByLabel("Search players").boundingBox()).height).toBe(36);
    expect((await picker.getByRole("button", { name: "Filters", exact: true }).boundingBox()).height).toBe(36);
    await expect(picker.getByText("AVAILABLE PLAYERS", { exact: false })).toContainText("11");
    await picker.getByRole("button", { name: "Sort by Owned %", exact: true }).click();
    await expect(header("Owned %")).toHaveAttribute("aria-sort", "descending");
    await expect(picker.locator("tbody > tr").first()).toContainText("100%");
    await picker.getByRole("button", { name: "Sort by Owned %", exact: true }).click();
    await expect(picker.locator("tbody > tr").first()).toContainText("0%");
    await picker.getByRole("button", { name: "Sort by Player", exact: true }).click();
    await expect(header("Player")).toHaveAttribute("aria-sort", "ascending");
    await expect(picker.locator("tbody > tr").first().getByRole("cell").first()).toContainText("F. Player0");
    await picker.getByRole("button", { name: "Sort by Player", exact: true }).click();
    await expect(header("Player")).toHaveAttribute("aria-sort", "descending");
    await expect(picker.locator("tbody > tr").first().getByRole("cell").first()).toContainText("F. Player9");
    await picker.getByRole("button", { name: "Sort by Form", exact: true }).click();
    await expect(header("Form")).toHaveAttribute("aria-sort", "descending");
    const rowFor = (index) => picker.locator("tbody > tr").filter({ has: page.getByRole("button", { name: `View statistics for Functional Player${index}`, exact: true }) });
    await expect(rowFor(9).getByRole("button", { name: "Over budget", exact: true })).toHaveText("Over budget");
    await expect(rowFor(10).getByRole("button", { name: "Club limit", exact: true })).toBeDisabled();
    await expect(rowFor(8).getByRole("button", { name: "Add", exact: true })).toHaveText("+");
    await expect(ownedRow.getByRole("button", { name: "Selected", exact: true })).toHaveText("Selected");
    await expect(ownedRow.getByRole("img", { name: "Halmstad BTK logo" })).toBeVisible();
    const colors = await ownedRow.locator("td").evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).color));
    expect(colors[3]).not.toBe(colors[1]);
    expect(colors[1]).toBe(colors[4]);
    expect((await rowFor(8).getByRole("button", { name: "Add", exact: true }).boundingBox()).height).toBe(32);
    await capture(page, testInfo, "transfer-statistics-mobile-390");
    await page.setViewportSize({ width: 390, height: 568 });
    const scroller = picker.getByLabel("Transfer player list", { exact: true });
    const searchTop = (await picker.getByLabel("Search players").boundingBox()).y;
    await scroller.evaluate((element) => { element.scrollTop = 240; });
    await expect(outgoing).not.toBeInViewport();
    await expect(picker.getByRole("heading", { name: "Replace player", exact: true })).toBeInViewport();
    await expect(picker.getByLabel("Search players")).toBeInViewport();
    await expect(picker.getByRole("button", { name: "Filters", exact: true })).toBeInViewport();
    expect((await picker.getByLabel("Search players").boundingBox()).y).toBe(searchTop);
    await capture(page, testInfo, "transfer-sticky-header-mobile-390x568");
    await picker.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(picker.getByLabel("Filter by club")).toBeInViewport();
    await picker.getByLabel("Only affordable").check();
    await expect(rowFor(9)).toHaveCount(0);
    await picker.getByLabel("Only affordable").uncheck();
    await picker.getByLabel("Filter by club").selectOption(fixture.clubs[0].name);
    await expect(picker.locator("tbody > tr")).toHaveCount(2);
    await picker.getByLabel("Filter by club").selectOption("all");
    await picker.getByRole("button", { name: "Filters", exact: true }).click();
    await scroller.evaluate((element) => { element.scrollTop = 0; });
    await page.setViewportSize({ width: 390, height: 844 });
    await picker.getByLabel("Search players").fill("Functional Player9");
    await expect(outgoing).toContainText("F. Player0");
    await capture(page, testInfo, "transfer-over-budget-mobile-390");
    await picker.getByLabel("Search players").fill("Functional");
    // Every player/statistic field opens the same read-only dialog. Closing it
    // returns focus to the exact field and preserves the underlying picker.
    async function checkStatisticsField(button) {
      await button.click();
      await expect(details.getByRole("heading", { name: "Recent form" })).toBeVisible();
      await expect(details.getByRole("button", { name: /^(Add player|Selected)$/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(details).not.toBeVisible();
      await expect(picker).toBeVisible();
      await expect(button).toBeFocused();
    }
    await checkStatisticsField(outgoing.getByRole("button", { name: "View statistics for Functional Player0", exact: true }));
    await checkStatisticsField(outgoing.getByRole("button", { name: "View Price statistics for Functional Player0", exact: true }));
    for (const metric of ["Price", "Form", "Owned %"]) {
      await checkStatisticsField(ownedRow.getByRole("button", { name: `View ${metric} statistics for Functional Player0`, exact: true }));
    }
    const playerButton = ownedRow.getByRole("button", { name: "View statistics for Functional Player0", exact: true });
    await playerButton.click();
    await expect(details).toBeVisible();
    await expect(details.getByRole("button", { name: "Selected", exact: true })).toHaveCount(0);
    await details.getByRole("button", { name: "Close player statistics", exact: true }).click();
    await expect(picker.getByLabel("Search players")).toHaveValue("Functional");
    await expect(header("Form")).toHaveAttribute("aria-sort", "descending");
    await expect(playerButton).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    for (const width of [320, 639, 640, 767, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const metricBoxes = await Promise.all(["Price", "Form", "Owned %"].map((label) => header(label).boundingBox()));
      expect(Math.abs(metricBoxes[0].width - metricBoxes[1].width)).toBeLessThan(1);
      expect(Math.abs(metricBoxes[1].width - metricBoxes[2].width)).toBeLessThan(1);
      expect(await rowFor(9).getByRole("button", { name: "Over budget", exact: true }).evaluate((button) => button.scrollWidth <= button.clientWidth)).toBe(true);
      if (width === 320) await capture(page, testInfo, "transfer-statistics-mobile-320");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await picker.getByRole("button", { name: "Sort by Pts", exact: true }).click();
    await expect(header("Pts")).toHaveAttribute("aria-sort", "descending");
    await picker.getByRole("button", { name: "Sort by Singles %", exact: true }).click();
    await expect(header("Singles %")).toHaveAttribute("aria-sort", "descending");
    for (const metric of ["Pts", "Singles %"]) {
      const field = ownedRow.getByRole("button", { name: `View ${metric} statistics for Functional Player0`, exact: true });
      await field.focus();
      await page.keyboard.press("Enter");
      await expect(details).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(field).toBeFocused();
    }
    await capture(page, testInfo, "transfer-statistics-desktop-1440");
    await playerButton.click();
    await expect(details.getByRole("heading", { name: "Recent form" })).toBeVisible();
    await capture(page, testInfo, "player-statistics-desktop-1440");
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(details.getByRole("button", { name: "Close player statistics" })).toBeInViewport();
    await details.getByRole("heading", { name: "Gameweek history" }).scrollIntoViewIfNeeded();
    await expect(details.getByRole("heading", { name: "Gameweek history" })).toBeInViewport();
    await capture(page, testInfo, "player-statistics-short-mobile-320");
    await page.setViewportSize({ width: 1440, height: 900 });
    await details.getByRole("button", { name: "Close player statistics" }).click();
    await picker.getByLabel("Search players").fill("Functional Player8");
    await picker.getByRole("button", { name: "View statistics for Functional Player8" }).click();
    const unplayed = page.getByRole("dialog", { name: "Functional Player8 statistics" });
    await expect(unplayed.getByRole("heading", { name: "Recent form" })).toBeVisible();
    await expect(unplayed.getByRole("list", { name: "Recent gameweek scores" }).getByRole("listitem")).toHaveCount(5);
    await expect(unplayed.getByRole("list", { name: "Recent gameweek scores" }).getByText("-", { exact: true })).toHaveCount(5);
    await expect(unplayed.getByText("Owned %", { exact: true }).first().locator("..")).toContainText("0%");
    await expect(unplayed.getByRole("button", { name: "Add player", exact: true })).toHaveCount(0);
    await expect(picker.getByLabel("Search players")).toHaveValue("Functional Player8");
    await unplayed.getByRole("button", { name: "Close player statistics", exact: true }).click();
    await expect(outgoing).toContainText("F. Player0");
    await expect(rowFor(8).getByRole("button", { name: "Add", exact: true })).toBeEnabled();
    await rowFor(8).getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open actions for Functional Player8" })).toBeVisible();
    // Only the transfer window adds players, retaining the unsaved draft flow.
    const saved = checked(await fixture.admin.from("fantasy_team_players").select("player_id").eq("fantasy_team_id", fixture.teamId), "Read unchanged saved squad");
    expect(saved.some((p) => p.player_id === fixture.players[0].id)).toBe(true);
    expect(saved.some((p) => p.player_id === fixture.players[8].id)).toBe(false);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    expect(errors).toEqual([]);
  });

  test("detail loading, retry and empty searches", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.getByRole("button", { name: "Open actions for Functional Player6" }).click();
    await page.getByRole("dialog", { name: "Functional Player6", exact: true }).getByRole("button", { name: "Transfer player", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Replace player", exact: true });
    await picker.getByLabel("Search players").fill("missing-player-xyz");
    await expect(picker.getByText("No players match your filters.")).toBeVisible();
    await picker.getByLabel("Search players").fill("Functional Player9");
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const statsUrl = `**/api/players/${fixture.players[9].id}`;
    await page.route(statsUrl, async (route) => { await gate; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Could not load player statistics. Please try again." }) }); });
    await picker.getByRole("button", { name: "View statistics for Functional Player9" }).click();
    const details = page.getByRole("dialog", { name: "Functional Player9 statistics" });
    await expect(details.getByRole("status")).toContainText("Loading player statistics");
    release();
    await expect(details.getByRole("alert")).toContainText("Could not load player statistics");
    await page.unroute(statsUrl);
    await details.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(details.getByRole("heading", { name: "Recent form" })).toBeVisible();
    await details.getByRole("button", { name: "Close player statistics" }).click();
    await picker.getByRole("button", { name: "Close player picker" }).click();
    await page.getByRole("button", { name: "Close player actions" }).click();
  });
});

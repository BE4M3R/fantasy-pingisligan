import { expect, test } from "@playwright/test";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "../functional/fixture.mjs";

let fixture;

test.describe.serial("manager gameweek journey", () => {
  test.beforeAll(async () => {
    fixture = await createFixture({ gameweeks: 3 });
    checked(await save(fixture, squad([
      fixture.players[0], fixture.players[2], fixture.players[4], fixture.players[6],
      fixture.players[1], fixture.players[3],
    ])), "Save browser test squad");
  });

  test.afterAll(async () => {
    if (fixture) await cleanupFixture(fixture);
  });

  async function login(page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard");
    await expect(page.getByLabel("Squad editor")).toBeVisible();
  }

  test("signed-in manager sees saved starters and bench", async ({ page }) => {
    await login(page);
    await expect(page.getByText("F.Player0").first()).toBeVisible();
    await expect(page.getByText("F.Player1").first()).toBeVisible();
  });

  test("manager changes captain and saves the squad", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Open actions for Functional Player2" }).click();
    await page.getByRole("button", { name: "Make Functional Player2 captain" }).click();
    await page.getByLabel("Squad editor").getByRole("button", { name: /^Save/i }).click();
    await expect(page.getByText("Team saved.")).toBeVisible();
  });

  test("manager transfers a player and swaps a starter with the bench, then sees both saved", async ({ page }) => {
    await login(page);
    const starters = page.getByRole("group", { name: "Table tennis starting lineup" });
    const bench = page.locator('section[aria-labelledby="bench-title"]');

    await starters.getByRole("button", { name: "Open actions for Functional Player6" }).click();
    await page.getByRole("dialog", { name: "Functional Player6" })
      .getByRole("button", { name: "Transfer player" }).click();
    const picker = page.getByRole("dialog", { name: "Replace player" });
    await picker.getByLabel("Search players").fill("Functional Player8");
    await picker.getByRole("button", { name: "Add", exact: true }).click();
    await expect(starters.getByRole("button", { name: "Open actions for Functional Player8" })).toBeVisible();
    await starters.getByRole("button", { name: "Open actions for Functional Player4" }).click();
    const actions = page.getByRole("dialog", { name: "Functional Player4" });
    await actions.getByRole("button", { name: "Swap", exact: true }).click();
    await actions.getByRole("button", { name: /Functional Player1/ }).click();
    await expect(starters.getByRole("button", { name: "Open actions for Functional Player1" })).toBeVisible();
    await expect(bench.getByRole("button", { name: "Open actions for Functional Player4" })).toBeVisible();

    await page.getByLabel("Squad editor").getByRole("button", { name: /^Save/i }).click();
    await expect(page.getByText("Team saved.")).toBeVisible();
    await page.reload();
    await expect(starters.getByRole("button", { name: "Open actions for Functional Player8" })).toBeVisible();
    await expect(starters.getByRole("button", { name: "Open actions for Functional Player1" })).toBeVisible();
    await expect(bench.getByRole("button", { name: "Open actions for Functional Player4" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open actions for Functional Player6" })).toHaveCount(0);

    const saved = checked(await fixture.admin.from("fantasy_team_players").select("player_id, position")
      .eq("fantasy_team_id", fixture.teamId), "Read saved transfer and swap");
    const byPlayer = Object.fromEntries(saved.map((player) => [player.player_id, player.position]));
    expect(byPlayer[fixture.players[8].id]).toBe("starter");
    expect(byPlayer[fixture.players[1].id]).toBe("starter");
    expect(byPlayer[fixture.players[4].id]).toBe("bench");
    expect(byPlayer[fixture.players[6].id]).toBeUndefined();
  });

  test("manager confirms a chip and sees it locked for the gameweek", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: /^Bench Boost\./ }).click();
    await page.getByRole("dialog", { name: "Bench Boost" }).getByRole("button", { name: "Confirm permanently" }).click();
    await expect(page.getByText("Bench Boost is confirmed for this gameweek and cannot be changed.")).toBeVisible();
  });

  test("scored gameweek appears after the production snapshot and completion flow", async ({ page }) => {
    await lock(fixture);
    const match = await addMatch(fixture);
    await addResult(fixture, match, { home: [fixture.players[0]], away: [fixture.players[2]] });
    await complete(fixture);
    await login(page);
    await page.getByRole("button", { name: "Result mode" }).click();
    await expect(page.getByLabel("Result gameweeks")).toContainText("13 pts");
    await expect(page.getByLabel("Squad editor")).toContainText("F.Player0");
    await page.getByRole("button", { name: "Open result details for Functional Player2" }).click();
    const breakdown = page.getByRole("dialog", { name: "Functional Player2" });
    await expect(breakdown.getByText("Lost singles set-score")).toBeVisible();
    await expect(breakdown.getByText("1 set won, 3 sets lost")).toBeVisible();
  });

  test("result navigation reuses cached results and shows each team's gameweek transfer cost", async ({ page }) => {
    const players = [fixture.players[0], fixture.players[4], fixture.players[5], fixture.players[7],
      fixture.players[9], fixture.players[10]];
    checked(await fixture.admin.from("fantasy_gameweeks").update({
      first_match_starts_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    }).eq("id", fixture.weeks[0].id), "Make first gameweek result visible in leagues");
    for (const [index, week] of fixture.weeks.slice(1).entries()) {
      checked(await save(fixture, squad(players), null, week), "Save next gameweek squad");
      checked(await fixture.admin.from("fantasy_gameweeks").update({
        first_match_starts_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      }).eq("id", week.id), "Make gameweek result visible");
      const snapshot = await lock(fixture, week);
      expect(snapshot.transfer_penalty_points).toBe(index === 0 ? -12 : 0);
      const match = await addMatch(fixture, { week });
      await addResult(fixture, match, { home: [fixture.players[0]], away: [fixture.players[2]] });
      await complete(fixture, week);
    }

    const requestedWeeks = [];
    await page.route(/\/api\/squad-results\?gameweek=/, async (route) => {
      requestedWeeks.push(new URL(route.request().url()).searchParams.get("gameweek"));
      await route.continue();
    });
    await login(page);
    const secondWeekResponse = page.waitForResponse((response) =>
      response.url().includes(`gameweek=${fixture.weeks[1].id}`) && response.ok());
    await page.getByRole("button", { name: "Result mode" }).click();
    const navigation = page.getByLabel("Result gameweeks");
    await expect(navigation).toContainText("Gameweek 3");
    await expect(navigation).toContainText("No transfer cost");
    await secondWeekResponse;
    await expect.poll(() => requestedWeeks.filter((id) => id === fixture.weeks[1].id).length).toBe(1);

    const firstWeekResponse = page.waitForResponse((response) =>
      response.url().includes(`gameweek=${fixture.weeks[0].id}`) && response.ok());
    await navigation.getByRole("button", { name: /View previous gameweek/ }).click();
    await expect(navigation).toContainText("Gameweek 2");
    await expect(navigation).not.toContainText("Loading gameweek…");
    await expect(navigation).toContainText("Includes -12 pts transfer cost");
    await firstWeekResponse;
    await expect.poll(() => requestedWeeks.filter((id) => id === fixture.weeks[0].id).length).toBe(1);

    await navigation.getByRole("button", { name: /View previous gameweek/ }).click();
    await expect(navigation).toContainText("Gameweek 1");
    await expect(navigation).not.toContainText("Loading gameweek…");
    await expect(navigation).toContainText("No transfer cost");
    await navigation.getByRole("button", { name: /View next gameweek/ }).click();
    await expect(navigation).toContainText("Gameweek 2");
    await expect(navigation).toContainText("Includes -12 pts transfer cost");
    await expect.poll(() => requestedWeeks.filter((id) => id === fixture.weeks[1].id).length).toBe(1);

    await page.goto("/dashboard/leagues");
    await page.getByRole("table").getByRole("button", { name: `Functional ${fixture.id}` }).click();
    const team = page.getByRole("dialog", { name: `Functional ${fixture.id}` });
    const teamNavigation = team.getByRole("navigation", { name: "Gameweek navigation" });
    await expect(teamNavigation).toContainText("Gameweek 3");
    await expect(teamNavigation).toContainText("No transfer cost");
    await teamNavigation.getByRole("button", { name: "Previous gameweek" }).click();
    await expect(teamNavigation).toContainText("Gameweek 2");
    await expect(teamNavigation).toContainText("Includes -12 pts transfer cost");
    await teamNavigation.getByRole("button", { name: "Previous gameweek" }).click();
    await expect(teamNavigation).toContainText("Gameweek 1");
    await expect(teamNavigation).toContainText("No transfer cost");
  });
});

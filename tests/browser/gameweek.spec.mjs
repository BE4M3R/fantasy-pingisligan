import { expect, test } from "@playwright/test";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "../functional/fixture.mjs";

let fixture;

test.describe.serial("manager gameweek journey", () => {
  test.beforeAll(async () => {
    fixture = await createFixture();
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
});

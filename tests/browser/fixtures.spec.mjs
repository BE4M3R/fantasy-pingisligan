import { expect, test } from "@playwright/test";
import { randomInt } from "node:crypto";
import { persistSchedule } from "../../scripts/import-stupa-schedule.mjs";
import { checked, cleanupFixture, createFixture, lock, save, squad } from "../functional/fixture.mjs";

test("Fixtures follows latest STUPA rounds and identifies the original locked scoring gameweek", async ({ page }, testInfo) => {
  const fixture = await createFixture({ gameweeks: 2 });
  try {
    checked(await save(fixture, squad([fixture.players[0], fixture.players[2], fixture.players[4],
      fixture.players[6], fixture.players[1], fixture.players[3]])), "Save fixture review squad");
    for (const [index, name] of [[0, "[TEST] Kosta SK"], [1, "[TEST] Spårvägens BTK"]]) {
      fixture.clubs[index].name = name;
      checked(await fixture.admin.from("clubs").update({ name }).eq("id", fixture.clubs[index].id), "Name synthetic schedule club");
    }
    const matchId = randomInt(100000000, 1000000000);
    const stageId = fixture.weeks[0].stupa_stage_id;
    const firstStart = new Date(Date.now() + 3 * 86400_000).toISOString();
    const returnStart = new Date(Date.now() + 100 * 86400_000).toISOString();
    const match = (id, weekIndex, startsAt) => ({
      id, round_id: fixture.weeks[weekIndex].stupa_round_id,
      round: { name: fixture.weeks[weekIndex].name, order: fixture.weeks[weekIndex].round_order },
      start_time: startsAt,
      end_time: new Date(Date.parse(startsAt) + 3 * 3600_000).toISOString(),
      status: "NOT_STARTED",
      participants: [
        { order: 1, participant_name: fixture.clubs[0].name },
        { order: 2, participant_name: fixture.clubs[1].name },
      ],
    });
    await persistSchedule(fixture.admin, [match(matchId, 0, firstStart), match(matchId + 10, 1, returnStart)], stageId);
    const snapshot = await lock(fixture);
    await persistSchedule(fixture.admin, [match(matchId + 10, 0, firstStart), match(matchId, 1, returnStart)], stageId);

    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard/fixtures");
    const first = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Gameweek 1", exact: true }) });
    const returning = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Gameweek 2", exact: true }) });
    const date = (value) => new Intl.DateTimeFormat("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Stockholm",
    }).format(new Date(value));
    await expect(first).toContainText(date(firstStart));
    await expect(first).not.toContainText(date(returnStart));
    await expect(first).toContainText("Fantasy points count towards Gameweek 2.");
    await expect(returning).toContainText(date(returnStart));
    await expect(returning).toContainText("Fantasy points count towards Gameweek 1.");
    await expect(first.getByRole("listitem")).toHaveCount(1);
    await expect(returning.getByRole("listitem")).toHaveCount(1);
    const preserved = checked(await fixture.admin.from("fantasy_team_gameweek_snapshots")
      .select("*").eq("fantasy_team_id", fixture.teamId)
      .eq("fantasy_gameweek_id", fixture.weeks[0].id).single(), "Read unchanged locked snapshot");
    expect(preserved).toEqual(snapshot);

    await page.evaluate(() => document.fonts.ready);
    for (const [width, height] of [[320, 844], [390, 844], [768, 1024], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 390 || width === 1440) {
        const screenshot = testInfo.outputPath(`fixtures-latest-round-locked-scoring-${width}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        await testInfo.attach(`fixtures-${width}`, { path: screenshot, contentType: "image/png" });
      }
    }
  } finally {
    await cleanupFixture(fixture);
  }
});

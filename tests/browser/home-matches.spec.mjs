import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "../functional/fixture.mjs";

test.use({ timezoneId: "America/Los_Angeles" });

const stockholmDate = (value) => new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Stockholm",
}).format(new Date(value));
const stockholmTime = (value) => new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm",
}).format(new Date(value));

test("home matches fit mobile screens and refresh scores, streams and failures without a page reload", async ({ page }) => {
  const fixture = await createFixture({ gameweeks: 2 });
  try {
    checked(await save(fixture, squad([fixture.players[0], fixture.players[2], fixture.players[4],
      fixture.players[6], fixture.players[1], fixture.players[3]])), "Save home test squad");
    checked(await fixture.admin.from("fantasy_teams").update({ name: "My fantasy club" }).eq("id", fixture.teamId), "Name preview team");
    const match = {
      id: randomUUID(), fantasy_gameweek_id: fixture.weeks[0].id,
      home_team_name: "BTK Rekord", away_team_name: "Eslövs AI BTK",
      starts_at: new Date(Date.now() + 120_000).toISOString(), status: "scheduled",
    };
    checked(await fixture.admin.from("matches").insert([match, {
      ...match, id: randomUUID(), home_team_name: "Linden BTK Esklistuna", away_team_name: "Spårvägens BTK",
    }, {
      ...match, id: randomUUID(), home_team_name: "Kosta SK", away_team_name: "Halmstad BTK",
    }, {
      ...match, id: randomUUID(), fantasy_gameweek_id: fixture.weeks[1].id,
      home_team_name: "Other week home", away_team_name: "Other week away",
    }]), "Create upcoming home fixtures");
    await page.clock.install();
    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard/overview");
    await expect(page.getByText("GW Open", { exact: true })).toBeVisible();
    await lock(fixture);
    await page.reload();
    await expect(page.getByText("GW Live", { exact: true })).toBeVisible();
    await expect(page.getByText("GW Locked", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Squad unlocks from", { exact: true })).toBeVisible();
    const unlockDate = new Date(fixture.weeks[0].unlock_at);
    const unlockDay = new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "short", timeZone: "Europe/Stockholm",
    }).format(unlockDate);
    const unlockTime = new Intl.DateTimeFormat("sv-SE", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm",
    }).format(unlockDate);
    await expect(page.getByText(`${unlockDay} · ${unlockTime}`, { exact: true })).toBeVisible();
    const card = page.getByRole("region", { name: "Matches", exact: true });
    await expect(card.getByRole("heading", { name: "Upcoming matches", exact: true })).toBeVisible();
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(stockholmDate(match.starts_at));
    await expect(card.locator("xpath=following-sibling::section[1]")).toContainText("Squad status");
    await expect(card.getByRole("listitem")).toHaveCount(3);
    await expect(card).not.toContainText("Other week home");
    for (const name of ["BTK Rekord", "Eslövs AI BTK", "Eskilstuna by STIGA",
      "Spårvägens BTK", "Kosta SK", "Halmstad BTK"]) {
      await expect(card.locator(`[title="${name}"]`)).toHaveCount(1);
    }
    for (const row of await card.getByRole("listitem").all()) {
      await expect(row.locator("time")).toHaveText(stockholmTime(match.starts_at));
    }
    await expect(card.getByText("LIVE", { exact: true })).toHaveCount(0);
    await expect(card.getByRole("link", { name: /Watch BTK Rekord vs/ })).toHaveAttribute("href", "https://www.youtube.com/@BTKRekord1/streams");
    await expect(card.getByRole("link", { name: /Watch Eskilstuna by STIGA vs/ })).toHaveAttribute("href", "https://www.youtube.com/@EskilstunabySTIGA/streams");
    await expect(card.getByRole("link", { name: /Watch Kosta SK vs/ })).toHaveAttribute("href", "https://www.youtube.com/@KostaSKPingis/streams");
    await expect(card.getByRole("link", { name: /All fixtures/ })).toHaveCount(0);
    await expect(card).not.toContainText("Times in Stockholm");
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(card).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const row of await card.getByRole("listitem").all()) {
        expect((await row.boundingBox()).height).toBeLessThanOrEqual(56);
      }
    }
    await page.setViewportSize({ width: 390, height: 900 });
    let fail = false;
    let requests = 0;
    let finished = false;
    await page.route("**/api/home-matches?*", (route) => {
      requests++;
      return route.fulfill({ status: fail ? 503 : 200, json: { matches: [{
        ...match, status: "in_progress", home_score: finished ? 5 : 3, away_score: 1,
        stream_url: "https://www.youtube.com/watch?v=home-test", source_updated_at: new Date().toISOString(),
      }, {
        ...match, id: "upcoming-preview", home_team_name: "Kosta SK", away_team_name: "Halmstad BTK",
        status: finished ? "completed" : "scheduled",
        starts_at: new Date(Date.now() + 3_600_000).toISOString(), home_score: 0, away_score: 0,
        stream_url: null,
      }, {
        ...match, id: "final-preview", home_team_name: "Söderhamns UIF", away_team_name: "Spårvägens BTK",
        status: "in_progress", home_score: 5, away_score: 3, stream_url: null,
      }], error: fail } });
    });
    await page.clock.fastForward(60_000);
    const liveCard = page.getByRole("region", { name: "Matches", exact: true });
    await expect(page.getByText("GW Live", { exact: true })).toBeVisible();
    await expect(page.getByText("GW Live", { exact: true })).toHaveClass(/text-\[var\(--pf-fantasy-yellow\)\]/);
    await expect(liveCard.getByText("LIVE", { exact: true })).toHaveCount(1);
    await expect(liveCard.getByText("Live", { exact: true })).toHaveCount(0);
    await expect(liveCard).toContainText("3–1");
    await expect(liveCard).toContainText("5–3");
    await expect(liveCard).not.toContainText("Final");
    const liveRow = liveCard.getByRole("listitem").filter({ hasText: "3–1" });
    await expect(liveRow).toHaveCSS("animation-name", "none");
    const upcomingRow = liveCard.getByRole("listitem").filter({ has: page.getByText("vs", { exact: true }) });
    await expect(liveRow).toHaveCSS("border-color", await upcomingRow.evaluate((row) => getComputedStyle(row).borderColor));
    const liveDot = liveRow.locator(".match-live-dot");
    await expect(liveDot).toHaveCSS("animation-duration", "1s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(liveDot).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(liveDot).toHaveCSS("animation-name", "match-live-pulse");
    await expect(liveCard.getByRole("listitem").filter({ hasText: "5–3" }).locator(".match-live-dot")).toHaveCount(0);
    const stream = liveCard.getByRole("link", { name: /Watch BTK Rekord vs Eslövs AI BTK/ });
    await expect(stream).toHaveAttribute("href", "https://www.youtube.com/watch?v=home-test");
    await expect(stream).toHaveAttribute("target", "_blank");
    await expect(stream.locator("span")).toHaveCSS("border-width", "0px");
    await expect(stream.locator("span")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const touchTarget = await stream.boundingBox();
    expect(touchTarget.width).toBeGreaterThanOrEqual(36);
    expect(touchTarget.height).toBeGreaterThanOrEqual(36);
    expect(requests).toBe(1);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const row of await liveCard.getByRole("listitem").all()) {
        expect((await row.boundingBox()).height).toBeLessThanOrEqual(56);
      }
      await page.screenshot({ path: `test-results/browser/home-matches-${width}.png`, fullPage: true });
    }
    fail = true;
    await page.clock.fastForward(60_000);
    await expect(liveCard).toContainText("Update unavailable");
    await expect(liveCard).toContainText("3–1");
    expect(requests).toBe(2);
    await expect(page.getByText("GW Live", { exact: true })).toBeVisible();
    fail = false;
    finished = true;
    await page.clock.fastForward(60_000);
    await expect(liveCard).toContainText("5–1");
    await expect(liveCard.locator(".match-live-dot")).toHaveCount(0);
    await expect(page.getByText("GW Live", { exact: true })).toBeVisible();

    // Passing unlock time still requires persisted results, scoring and refresh
    // completion before the badge can return to Open.
    checked(await fixture.admin.from("fantasy_gameweeks").update({
      unlock_at: new Date(Date.now() - 60_000).toISOString(),
    }).eq("id", fixture.weeks[0].id), "Pass home gameweek unlock time");
    await page.reload();
    await expect(page.getByText("GW Live", { exact: true })).toBeVisible();
    await expect(page.getByText("Updating results and scores...", { exact: true })).toBeVisible();
    checked(await fixture.admin.from("matches").update({ status: "scored" })
      .eq("fantasy_gameweek_id", fixture.weeks[0].id), "Persist completed fixture statuses");
    const result = await addMatch(fixture);
    await addResult(fixture, result, { home: [fixture.players[0]], away: [fixture.players[2]] });
    await complete(fixture);
    await page.reload();
    await expect(page.getByText("GW Open", { exact: true })).toBeVisible();
  } finally {
    await cleanupFixture(fixture);
  }
});

test("home fixtures refresh from the selected gameweek and change state at kickoff and five wins", async ({ page }) => {
  const fixture = await createFixture({ gameweeks: 2 });
  try {
    const firstStart = new Date(Date.now() + 120 * 60_000).toISOString();
    const revisedStart = new Date(Date.parse(firstStart) - 112 * 60_000).toISOString();
    const match = {
      id: randomUUID(), fantasy_gameweek_id: fixture.weeks[0].id,
      home_team_name: "BTK Rekord", away_team_name: "Eslövs AI BTK",
      starts_at: firstStart, status: "scheduled",
    };
    checked(await fixture.admin.from("matches").insert([match, {
      ...match, id: randomUUID(), fantasy_gameweek_id: fixture.weeks[1].id,
      home_team_name: "Other week home", away_team_name: "Other week away",
    }]), "Create fixtures in separate gameweeks");

    await page.clock.install();
    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard/overview");

    const card = page.getByRole("region", { name: "Matches", exact: true });
    await expect(card.getByRole("listitem")).toHaveCount(1);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(stockholmDate(firstStart));
    await expect(card.locator("time")).toHaveText(stockholmTime(firstStart));
    await expect(card.locator('[title="BTK Rekord"]')).toHaveCount(1);
    await expect(card.locator('[title="Eslövs AI BTK"]')).toHaveCount(1);
    await expect(card).not.toContainText("Other week home");

    let requests = 0;
    let updatedMatch = {
      ...match, starts_at: revisedStart, home_team_name: "Kosta SK",
      away_team_name: "Halmstad BTK", home_score: 0, away_score: 0,
      stream_url: null, source_updated_at: null,
    };
    await page.route("**/api/home-matches?*", (route) => {
      requests++;
      return route.fulfill({ json: { matches: [updatedMatch], error: false } });
    });

    // A refreshed schedule moves kickoff and both clubs while the tab stays open.
    await page.clock.fastForward(6 * 60_000);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(stockholmDate(revisedStart));
    await expect(card.locator("time")).toHaveText(stockholmTime(revisedStart));
    await expect(card.locator('[title="Kosta SK"]')).toHaveCount(1);
    await expect(card.locator('[title="Halmstad BTK"]')).toHaveCount(1);
    await expect(card.locator('[title="BTK Rekord"]')).toHaveCount(0);
    await expect(card.getByText("LIVE", { exact: true })).toHaveCount(0);
    expect(requests).toBe(1);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(requests).toBe(1);

    // The scheduled start alone makes the fixture live, even with no score.
    await page.clock.fastForward(121_000);
    await expect(card.getByText("LIVE", { exact: true })).toHaveCount(1);
    await expect(card).toContainText("0–0");
    expect(requests).toBe(2);

    // A fifth club win ends LIVE even if the imported status still says in progress.
    updatedMatch = { ...updatedMatch, status: "in_progress", home_score: 5 };
    await page.clock.fastForward(61_000);
    await expect(card).toContainText("5–0");
    await expect(card.getByText("LIVE", { exact: true })).toHaveCount(0);
    expect(requests).toBe(3);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("home matches go live at kickoff and stay live across Stockholm midnight", async ({ page }) => {
  const fixture = await createFixture();
  try {
    checked(await save(fixture, squad([fixture.players[0], fixture.players[2], fixture.players[4],
      fixture.players[6], fixture.players[1], fixture.players[3]])), "Save kickoff test squad");
    await lock(fixture);
    checked(await fixture.admin.from("matches").insert({
      id: randomUUID(), fantasy_gameweek_id: fixture.weeks[0].id,
      home_team_name: "BTK Rekord", away_team_name: "Eslövs AI BTK",
      starts_at: new Date(Date.now() - 60_000).toISOString(), status: "scheduled",
    }), "Create started fixture with upcoming gameweek timing");
    await page.clock.install();
    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard/overview");
    await expect(page.getByRole("region", { name: "Matches", exact: true }).getByText("LIVE", { exact: true })).toBeVisible();
    await expect(page.getByText("GW Live", { exact: true })).toBeVisible();
    await expect(page.getByText("Squad is locked", { exact: true })).toBeVisible();

    // The first UTC date is 3 October in Stockholm; the next two are 4 October.
    // Grouping must follow Stockholm even when the browser uses another zone.
    await page.route("**/api/home-matches?*", (route) => route.fulfill({ json: { matches: [
      { id: "live", home_team_name: "BTK Rekord", away_team_name: "Eslövs AI BTK",
        starts_at: "2026-10-03T21:00:00Z", status: "scheduled", home_score: 0, away_score: 0, stream_url: null },
      { id: "upcoming", home_team_name: "Kosta SK", away_team_name: "Halmstad BTK",
        starts_at: "2026-10-03T22:30:00Z", status: "scheduled", home_score: 0, away_score: 0, stream_url: null },
      { id: "later", home_team_name: "Söderhamns UIF", away_team_name: "Spårvägens BTK",
        starts_at: "2026-10-04T01:26:00Z", status: "scheduled", home_score: 0, away_score: 0, stream_url: null },
      { id: "unconfirmed", home_team_name: null, away_team_name: null,
        starts_at: null, status: "scheduled", home_score: 0, away_score: 0, stream_url: null },
    ] } }));
    const card = page.getByRole("region", { name: "Matches", exact: true });
    // Server-rendered rows can be visible before the client polling effect
    // mounts. Advance the clock until a refresh has actually reached the UI.
    await expect.poll(async () => {
      await page.clock.fastForward(60_000);
      return card.getByRole("listitem").count();
    }).toBe(4);
    await page.clock.setSystemTime(new Date("2026-10-03T21:30:00Z"));
    await page.clock.fastForward(60_000);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(["Sat 3 Oct", "Sun 4 Oct", "Date TBC"]);
    const lists = card.getByRole("list");
    await expect(lists.nth(0).getByRole("listitem")).toHaveCount(1);
    await expect(lists.nth(1).getByRole("listitem")).toHaveCount(2);
    await expect(lists.nth(1).locator("time")).toHaveText(["00:30", "03:26"]);
    await expect(lists.nth(2)).toContainText("Time TBC");
    await expect(lists.nth(0)).toContainText("0–0");
    await expect(lists.nth(0).getByText("LIVE", { exact: true })).toHaveCount(1);
    await expect(lists.nth(0).locator("time")).toHaveCount(0);
    await page.clock.fastForward(30 * 60_000);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(["Sat 3 Oct", "Sun 4 Oct", "Date TBC"]);
    await expect(lists.nth(0).getByText("LIVE", { exact: true })).toBeVisible();
    await expect(lists.nth(1).getByText("LIVE", { exact: true })).toHaveCount(0);
    await page.clock.fastForward(30 * 60_000);
    await expect(lists.nth(1).getByText("LIVE", { exact: true })).toHaveCount(1);
  } finally {
    await cleanupFixture(fixture);
  }
});

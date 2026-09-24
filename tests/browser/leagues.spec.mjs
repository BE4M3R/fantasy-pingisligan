import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "../functional/fixture.mjs";

let fixture;
let guest;
let leagueId;
let inviteCode;

async function login(page, account) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function createGuest(f) {
  const account = {
    email: `league-guest-${randomUUID()}@example.invalid`,
    password: f.password,
    teamId: randomUUID(),
    teamName: `League Rival ${f.id.slice(0, 8)}`,
    userId: null,
    user: null,
  };
  guest = account;
  const auth = checked(await f.admin.auth.admin.createUser({
    email: account.email, password: account.password, email_confirm: true,
  }), "Create league guest");
  account.userId = auth.user.id;
  checked(await f.admin.from("fantasy_teams").insert({
    id: account.teamId, user_id: account.userId, name: account.teamName,
    onboarding_completed: true, created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  }), "Create league guest team");
  account.user = createClient(f.url, f.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  checked(await account.user.auth.signInWithPassword({
    email: account.email, password: account.password,
  }), "Sign in league guest");
  return account;
}

test.describe.serial("private league journey", () => {
  test.beforeAll(async () => {
    fixture = await createFixture({ gameweeks: 2 });
    guest = await createGuest(fixture);
    const players = [fixture.players[0], fixture.players[2], fixture.players[4], fixture.players[6],
      fixture.players[1], fixture.players[3]];
    const ownerSquad = squad(players);
    const guestSquad = squad(players, { captain: 1 });
    const guestFixture = { ...fixture, user: guest.user, teamId: guest.teamId };

    for (const [index, week] of fixture.weeks.entries()) {
      checked(await save(fixture, ownerSquad, null, week), "Save league owner squad");
      checked(await save(guestFixture, guestSquad, null, week), "Save league guest squad");
      checked(await fixture.admin.from("fantasy_gameweeks").update({
        first_match_starts_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      }).eq("id", week.id), "Make scored gameweek visible");
      await lock(fixture, week);
      const match = index === 0
        ? await addMatch(fixture, { week })
        : await addMatch(fixture, { week, homeClub: 2, awayClub: 3 });
      await addResult(fixture, match, index === 0
        ? { home: [fixture.players[0]], away: [fixture.players[2]] }
        : { home: [fixture.players[4]], away: [fixture.players[6]] });
      await complete(fixture, week);
      const scores = checked(await fixture.admin.from("fantasy_team_gameweek_points")
        .select("fantasy_team_id, points").eq("fantasy_gameweek_id", week.id), "Read seeded league scores");
      const byTeam = Object.fromEntries(scores.map((row) => [row.fantasy_team_id, row.points]));
      assert.equal(byTeam[fixture.teamId], index === 0 ? 21 : 11);
      assert.equal(byTeam[guest.teamId], index === 0 ? 12 : 11);
    }
  });

  test.afterAll(async () => {
    if (!fixture) return;
    if (leagueId) checked(await fixture.admin.from("leagues").delete().eq("id", leagueId), "Remove test league");
    if (guest?.userId) {
      checked(await fixture.admin.from("fantasy_teams").delete().eq("id", guest.teamId), "Remove league guest team");
      checked(await fixture.admin.auth.admin.deleteUser(guest.userId), "Remove league guest");
    }
    await cleanupFixture(fixture);
  });

  test("owner creates a private league and receives an invitation code", async ({ page }) => {
    await login(page, fixture);
    await page.goto("/dashboard/leagues");
    await page.getByRole("button", { name: "Private league", exact: true }).click();
    await page.getByLabel("League name").fill(`Browser League ${fixture.id.slice(0, 8)}`);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/leagues\/[a-f0-9-]+/);
    await expect(page.getByText("Private league created. Share the invitation with your friends.")).toBeVisible();
    const codeButton = page.getByRole("button", { name: /^Copy invite code / });
    await expect(codeButton).toBeVisible();
    inviteCode = (await codeButton.getAttribute("aria-label")).replace("Copy invite code ", "");
    leagueId = new URL(page.url()).pathname.split("/").at(-1);
    expect(inviteCode).toMatch(/^[A-Z0-9]{8}$/);
  });

  test("second manager joins by invitation code and appears in league standings", async ({ page }) => {
    await login(page, guest);
    await page.goto("/dashboard/leagues");
    await page.getByRole("button", { name: "Join league", exact: true }).click();
    await page.getByLabel("Invitation code").fill(inviteCode);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/leagues/${leagueId}`));
    await expect(page.getByText("You joined the private league.")).toBeVisible();
    await expect(page.getByRole("table").getByRole("button", { name: guest.teamName })).toBeVisible();
    await expect(page.getByRole("table").getByRole("button", { name: `Functional ${fixture.id}` })).toBeVisible();
  });

  test("pressing a team name shows its exact scores while navigating between gameweeks", async ({ page }) => {
    await login(page, fixture);
    await page.goto(`/dashboard/leagues/${leagueId}`);
    await page.getByRole("table").getByRole("button", { name: guest.teamName }).click();
    const scores = page.getByRole("dialog", { name: guest.teamName });
    await expect(scores).toBeVisible();
    await expect(scores.getByText("Gameweek 2", { exact: true })).toBeVisible();
    await expect(scores.getByText("11", { exact: true })).toBeVisible();
    await scores.getByRole("button", { name: "Previous gameweek" }).click();
    await expect(scores.getByText("Gameweek 1", { exact: true })).toBeVisible();
    await expect(scores.getByText("12", { exact: true })).toBeVisible();
    await scores.getByRole("button", { name: "Next gameweek" }).click();
    await expect(scores.getByText("Gameweek 2", { exact: true })).toBeVisible();
    await expect(scores.getByText("11", { exact: true })).toBeVisible();
  });
});

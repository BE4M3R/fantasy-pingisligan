import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const password = "functional-test-12";

function envFile(content) {
  return Object.fromEntries(content.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    return match ? [[match[1], match[2].trim().replace(/^(['"])(.*)\1$/, "$2")]] : [];
  }));
}

export async function localClients() {
  const isolated = process.env.FUNCTIONAL_TEST_SUPABASE_URL;
  const fileValues = isolated ? {} : envFile(await readFile(new URL("../../.env.local", import.meta.url), "utf8"));
  const env = { ...fileValues, ...process.env };
  const url = env.FUNCTIONAL_TEST_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const parsedUrl = new URL(url);
  assert.equal(parsedUrl.protocol, "http:", "Functional tests require an HTTP local Supabase API.");
  assert.equal(parsedUrl.hostname, "127.0.0.1", "Functional tests require a 127.0.0.1 Supabase API.");
  const anonKey = env.FUNCTIONAL_TEST_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.FUNCTIONAL_TEST_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(anonKey, "Missing local anon key");
  assert.ok(serviceKey, "Missing local service role key");
  return {
    admin: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    anonKey,
    url,
  };
}

export async function assertCleanDatabase(admin) {
  const [existingTeams, existingWeeks] = await Promise.all([
    admin.from("fantasy_teams").select("id", { head: true, count: "exact" }),
    admin.from("fantasy_gameweeks").select("id", { head: true, count: "exact" }),
  ]);
  checked(existingTeams, "Check test database teams");
  checked(existingWeeks, "Check test database gameweeks");
  assert.equal(existingTeams.count, 0,
    `Local database has ${existingTeams.count} fantasy team(s). Run npm run test:all for an isolated stack.`);
  assert.equal(existingWeeks.count, 0,
    `Local database has ${existingWeeks.count} gameweek(s). Run npm run test:all for an isolated stack.`);
}

export function checked(result, context) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

const minutes = (amount) => new Date(Date.now() + amount * 60000).toISOString();

export async function createFixture({ gameweeks = 1 } = {}) {
  const { admin, anonKey, url } = await localClients();
  await assertCleanDatabase(admin);
  const id = randomUUID();
  const email = `functional-${id}@example.invalid`;
  const roundBase = randomInt(100000000, 1900000000);
  const clubs = Array.from({ length: 5 }, (_, index) => ({ id: randomUUID(), name: `[TEST ${id}] Club ${index}` }));
  const players = Array.from({ length: 11 }, (_, index) => ({
    id: randomUUID(), club_id: clubs[index === 10 ? 0 : Math.floor(index / 2)].id,
    first_name: "Functional", last_name: `Player${index}`,
    stupa_user_role_id: -(roundBase + index), price: 10000000, active: true,
  }));
  const weeks = Array.from({ length: gameweeks }, (_, index) => ({
    id: randomUUID(), stupa_round_id: -(roundBase + 100 + index),
    stupa_stage_id: -(roundBase + 500), name: `[TEST ${id}] GW${index + 1}`,
    round_order: index + 1,
    first_match_starts_at: minutes(120 + index * 180),
    last_match_ends_at: minutes(150 + index * 180),
    lock_at: minutes(60 + index * 180), unlock_at: minutes(180 + index * 180),
  }));
  const fixture = { admin, anonKey, url, id, email, password, clubs, players, weeks, userId: null, teamId: randomUUID() };
  try {
    checked(await admin.from("clubs").insert(clubs), "Create test clubs");
    checked(await admin.from("players").insert(players), "Create test players");
    checked(await admin.from("fantasy_gameweeks").insert(weeks), "Create test gameweeks");
    const user = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true }), "Create test user");
    fixture.userId = user.user.id;
    checked(await admin.from("fantasy_teams").insert({ id: fixture.teamId, user_id: fixture.userId, name: `Functional ${id}`,
      onboarding_completed: true, created_at: minutes(-60) }), "Create test team");
    const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    checked(await userClient.auth.signInWithPassword({ email, password }), "Sign in test user");
    fixture.user = userClient;
    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

export async function cleanupFixture(fixture) {
  const { admin, weeks, players, clubs, userId, teamId } = fixture;
  // Restrict every deletion to IDs created by this fixture. Cascades remove results and snapshots.
  const weekIds = weeks.map((week) => week.id);
  checked(await admin.from("matches").delete().in("fantasy_gameweek_id", weekIds), "Remove test matches");
  checked(await admin.from("fantasy_teams").delete().eq("id", teamId), "Remove test team");
  checked(await admin.from("fantasy_gameweeks").delete().in("id", weekIds), "Remove test gameweeks");
  checked(await admin.from("players").delete().in("id", players.map((player) => player.id)), "Remove test players");
  checked(await admin.from("clubs").delete().in("id", clubs.map((club) => club.id)), "Remove test clubs");
  if (userId) checked(await admin.auth.admin.deleteUser(userId), "Remove test user");
}

export function squad(players, { captain = 0 } = {}) {
  return players.slice(0, 6).map((player, index) => ({
    player_id: player.id, position: index < 4 ? "starter" : "bench", is_captain: index === captain,
  }));
}

export async function save(fixture, rows, chip = null, week = fixture.weeks[0]) {
  return fixture.user.rpc("save_my_complete_fantasy_team", {
    p_gameweek_id: week.id, p_squad: rows, p_chip: chip,
  });
}

export async function lock(fixture, week = fixture.weeks[0]) {
  checked(await fixture.admin.from("fantasy_gameweeks").update({ lock_at: minutes(-10) }).eq("id", week.id), "Lock gameweek");
  checked(await fixture.admin.rpc("snapshot_locked_squads"), "Snapshot squads");
  return checked(await fixture.admin.from("fantasy_team_gameweek_snapshots")
    .select("*").eq("fantasy_team_id", fixture.teamId).eq("fantasy_gameweek_id", week.id).single(), "Read snapshot");
}

export async function complete(fixture, week = fixture.weeks[0]) {
  checked(await fixture.admin.from("fantasy_gameweeks").update({ unlock_at: minutes(-1) }).eq("id", week.id), "Pass unlock time");
  checked(await fixture.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: week.id }), "Score before completion");
  assert.equal(checked(await fixture.admin.rpc("complete_gameweek_refresh", {
    p_gameweek_id: week.id, p_refreshed_at: new Date().toISOString(),
  }), "Complete gameweek"), true);
}

export async function addMatch(fixture, { week = fixture.weeks[0], winner = "home", homeClub = 0, awayClub = 1 } = {}) {
  const homeId = -(randomInt(100000000, 1900000000));
  const awayId = homeId - 1;
  const match = { id: randomUUID(), fantasy_gameweek_id: week.id,
    home_club_id: fixture.clubs[homeClub].id, away_club_id: fixture.clubs[awayClub].id,
    home_team_stupa_participant_id: homeId, away_team_stupa_participant_id: awayId,
    winning_team_stupa_participant_id: winner === "home" ? homeId : awayId,
    status: "scored", starts_at: minutes(-5), ends_at: minutes(-1) };
  checked(await fixture.admin.from("matches").insert(match), "Create fixture match");
  return { match, homeId, awayId };
}

export async function addResult(fixture, game, { home, away, homeSets = 3, awaySets = 1, walkover = false, order = 1 }) {
  const id = -(randomInt(100000000, 1900000000));
  checked(await fixture.admin.from("stupa_submatches").insert({ stupa_submatch_id: id,
    match_id: game.match.id, match_order: order, status: "SCORED", raw_payload: {} }), "Create submatch");
  const rows = [
    ...home.map((player) => ({ player, teamId: game.homeId, won: homeSets > awaySets,
      setsWon: homeSets, setsLost: awaySets })),
    ...away.map((player) => ({ player, teamId: game.awayId, won: awaySets > homeSets,
      setsWon: awaySets, setsLost: homeSets })),
  ].map(({ player, teamId, won, setsWon, setsLost }, index) => ({
    stupa_submatch_id: id, player_id: player.id, stupa_user_role_id: player.stupa_user_role_id,
    player_name: `${player.first_name} ${player.last_name}`, team_stupa_participant_id: teamId,
    side_order: index < home.length ? 1 : 2, won, sets_won: setsWon, sets_lost: setsLost,
    walkover, raw_payload: {},
  }));
  checked(await fixture.admin.from("player_submatch_results").insert(rows), "Create player results");
}

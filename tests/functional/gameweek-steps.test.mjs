import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { kickoff, nextIndividualMatch, unlock } from "../../scripts/staging-gameweek-test.mjs";
import { addMatch, checked, cleanupFixture, createFixture, lock, save, squad } from "./fixture.mjs";

async function localScenario(t, { deferred = false } = {}) {
  const f = await createFixture();
  let secondUserId;
  t.after(async () => {
    if (secondUserId) checked(await f.admin.auth.admin.deleteUser(secondUserId), "Remove second manager");
    await cleanupFixture(f);
  });
  const rows = squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]]);
  checked(await save(f, rows), "Save first manager");
  const secondEmail = `steps-${randomUUID()}@example.invalid`;
  secondUserId = checked(await f.admin.auth.admin.createUser({
    email: secondEmail, password: f.password, email_confirm: true,
  }), "Create second manager").user.id;
  const secondTeamId = randomUUID();
  checked(await f.admin.from("fantasy_teams").insert({ id: secondTeamId, user_id: secondUserId,
    name: `Steps ${secondTeamId}`, onboarding_completed: true,
    created_at: new Date(Date.now() - 60 * 60000).toISOString(),
  }), "Create second team");
  const second = createClient(f.url, f.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  checked(await second.auth.signInWithPassword({ email: secondEmail, password: f.password }), "Sign in second manager");
  checked(await second.rpc("save_my_complete_fantasy_team", {
    p_gameweek_id: f.weeks[0].id, p_squad: rows, p_chip: null,
  }), "Save second manager");

  const name = (player) => `${player.first_name} ${player.last_name}`;
  const definitions = [];
  for (let index = 0; index < 2; index++) {
    const game = await addMatch(f, { homeClub: index * 2, awayClub: index * 2 + 1 });
    const homePlayers = f.players.slice(index * 4, index * 4 + 2);
    const awayPlayers = f.players.slice(index * 4 + 2, index * 4 + 4);
    const startsAfterMinutes = index * 1440;
    const startsAt = new Date(Date.now() + (120 + startsAfterMinutes) * 60000).toISOString();
    const matchId = f.weeks[0].stupa_round_id - 10000 - index;
    checked(await f.admin.from("matches").update({
      stupa_match_id: matchId, stupa_stage_id: f.weeks[0].stupa_stage_id,
      starts_at: startsAt, ends_at: new Date(Date.parse(startsAt) + 120 * 60000).toISOString(),
      status: "scheduled", winning_team_stupa_participant_id: null,
    }).eq("id", game.match.id), "Install synthetic fixture");
    const matches = index === 0 ? [
      { type: "singles", homePlayers: [name(homePlayers[0])], awayPlayers: [name(awayPlayers[0])], result: { homeSets: 3, awaySets: 1 } },
      { type: "singles", homePlayers: [name(homePlayers[0])], awayPlayers: [name(awayPlayers[1])], result: { homeSets: 3, awaySets: 2 } },
      { type: "doubles", isGoldenMatch: true, homePlayers: homePlayers.map(name), awayPlayers: awayPlayers.map(name), result: { homeSets: 3, awaySets: 1 } },
    ] : [
      { type: "singles", homePlayers: [name(homePlayers[0])], awayPlayers: [name(awayPlayers[0])], result: { homeSets: 3, awaySets: 0 } },
    ];
    definitions.push({
      key: `fixture-${index}`, matchId, startsAfterMinutes, durationMinutes: 120,
      homeParticipantId: game.homeId, awayParticipantId: game.awayId, winner: "home",
      ...(deferred && index === 1 ? { resultAvailableFromGameweek: "gw2" } : {}),
      home: { club: f.clubs[index * 2].name }, away: { club: f.clubs[index * 2 + 1].name },
      homePlayers, awayPlayers,
      fixturePlayersByName: new Map([...homePlayers, ...awayPlayers].map((player) => [name(player).toLocaleLowerCase("sv-SE"), player])),
      matches: matches.map((match, matchIndex) => ({ ...match, submatchId: matchId - 100 - index * 100 - matchIndex })),
    });
  }
  checked(await f.admin.from("fantasy_gameweeks").update({
    last_match_ends_at: new Date(Date.now() + 1680 * 60000).toISOString(),
    unlock_at: new Date(Date.now() + 2880 * 60000).toISOString(),
  }).eq("id", f.weeks[0].id), "Set two-day window");
  const definition = { key: "gw1", roundId: f.weeks[0].stupa_round_id, fixtures: definitions };
  const scenario = { stageId: f.weeks[0].stupa_stage_id, gameweeks: [definition],
    activePlayers: f.players, roleIds: new Map(f.players.map((player) => [player.id, player.stupa_user_role_id])) };
  return { f, definition, scenario };
}

async function state(f) {
  const weekId = f.weeks[0].id;
  const [week, matches, results, totals, snapshots, players, teams] = await Promise.all([
    f.admin.from("fantasy_gameweeks").select("*").eq("id", weekId).single(),
    f.admin.from("matches").select("*").eq("fantasy_gameweek_id", weekId).order("stupa_match_id", { ascending: false }),
    f.admin.from("stupa_submatches").select("*").order("stupa_submatch_id", { ascending: false }),
    f.admin.from("fantasy_team_gameweek_points").select("fantasy_team_id, points").eq("fantasy_gameweek_id", weekId).order("fantasy_team_id"),
    f.admin.from("fantasy_team_gameweek_players")
      .select("fantasy_team_id, fantasy_gameweek_id, player_id, position, is_captain, price_at_lock, club_id_at_lock, player_first_name_at_lock, player_last_name_at_lock, club_name_at_lock, lineup_order, created_at")
      .eq("fantasy_gameweek_id", weekId)
      .order("fantasy_team_id").order("lineup_order"),
    f.admin.from("players").select("id, price").in("id", f.players.map((player) => player.id)).order("id"),
    f.admin.from("fantasy_teams").select("id, budget").order("id"),
  ]);
  return Object.fromEntries(Object.entries({ week, matches, results, totals, snapshots, players, teams })
    .map(([key, result]) => [key, checked(result, `Read ${key}`)]));
}

test("locked local rounds advance from kickoff through singles/doubles and then use normal unlock", async (t) => {
  const { f, scenario, definition } = await localScenario(t);
  await assert.rejects(kickoff(f.admin, scenario, definition), /Run lock/);
  await lock(f);
  const original = await state(f);
  await assert.rejects(nextIndividualMatch(f.admin, scenario, definition), /Run kickoff/);
  await kickoff(f.admin, scenario, definition);
  let current = await state(f);
  assert.ok(Date.parse(current.week.first_match_starts_at) <= Date.now());
  assert.equal(current.results.length, 0);
  assert.ok(Date.parse(current.matches[1].starts_at) > Date.now(), "next playing day remains upcoming");
  const kickoffTimes = current.matches.map((row) => row.starts_at);
  await kickoff(f.admin, scenario, definition);
  assert.deepEqual((await state(f)).matches.map((row) => row.starts_at), kickoffTimes, "kickoff is idempotent");

  for (const [index, expectedPoints] of [13, 29, 47, 51].entries()) {
    await nextIndividualMatch(f.admin, scenario, definition);
    current = await state(f);
    assert.equal(current.results.length, index + 1, "one individual result per command");
    assert.deepEqual(current.totals.map((row) => Number(row.points)), [expectedPoints, expectedPoints]);
    assert.equal(current.week.data_refreshed_at, null);
    assert.equal(checked(await f.user.rpc("current_transfer_lock"), "Read lock")[0].is_locked, true);
    assert.deepEqual(current.snapshots, original.snapshots);
    assert.deepEqual(current.players, original.players);
    assert.deepEqual(current.teams, original.teams);
    assert.equal(current.matches[0].status, index < 2 ? "in_progress" : "scored");
    assert.equal(current.matches[0].winning_team_stupa_participant_id,
      index < 2 ? null : definition.fixtures[0].homeParticipantId);
    assert.equal(current.results.some((row) => row.raw_payload.local_scoring_pending), false);
  }
  assert.equal(current.results[2].match_order, 1, "golden doubles retains STUPA order");
  assert.equal(current.results[2].is_golden_match, true);
  const final = await state(f);
  await nextIndividualMatch(f.admin, scenario, definition);
  assert.deepEqual(await state(f), final, "exhausted next-match does nothing");
  await assert.rejects(kickoff(f.admin, scenario, definition), /already has results/);
  await unlock(f.admin, scenario, definition);
  current = await state(f);
  assert.ok(current.week.data_refreshed_at);
  assert.deepEqual(current.totals, final.totals, "bulk unlock preserves incremental scores");
  assert.equal(checked(await f.user.rpc("current_transfer_lock"), "Read reopened window")[0].is_locked, false);
  await assert.rejects(nextIndividualMatch(f.admin, scenario, definition), /already refreshed/);
});

test("a failed individual scoring step retries the same result before advancing", async (t) => {
  const { f, scenario, definition } = await localScenario(t);
  await lock(f);
  await kickoff(f.admin, scenario, definition);
  const failing = {
    supabaseUrl: f.admin.supabaseUrl,
    from: (...args) => f.admin.from(...args),
    rpc: async (name, args) => name === "calculate_fantasy_gameweek_points"
      ? { error: { message: "Injected scoring failure" } }
      : f.admin.rpc(name, args),
  };
  await assert.rejects(nextIndividualMatch(failing, scenario, definition), /Injected scoring failure/);
  let current = await state(f);
  assert.equal(current.results.length, 1);
  assert.equal(current.results[0].raw_payload.local_scoring_pending, true);
  assert.equal(current.week.data_refreshed_at, null);
  assert.equal(checked(await f.user.rpc("current_transfer_lock"), "Read lock after failure")[0].is_locked, true);
  await nextIndividualMatch(f.admin, scenario, definition);
  current = await state(f);
  assert.equal(current.results.length, 1, "retry completes the persisted result without consuming another match");
  assert.deepEqual(current.totals.map((row) => Number(row.points)), [13, 13]);
  assert.equal(current.results[0].raw_payload.local_scoring_pending, undefined);
  await nextIndividualMatch(f.admin, scenario, definition);
  assert.equal((await state(f)).results.length, 2);
});

test("individual stepping withholds delayed fixture results and leaves completion to unlock", async (t) => {
  const { f, scenario, definition } = await localScenario(t, { deferred: true });
  await lock(f);
  await kickoff(f.admin, scenario, definition);
  for (let index = 0; index < 3; index++) await nextIndividualMatch(f.admin, scenario, definition);
  const before = await state(f);
  await nextIndividualMatch(f.admin, scenario, definition);
  assert.deepEqual(await state(f), before);
  assert.equal(before.matches[1].status, "scheduled");
  await unlock(f.admin, scenario, definition);
  const after = await state(f);
  assert.equal(after.results.length, 3);
  assert.ok(after.week.data_refreshed_at);
});

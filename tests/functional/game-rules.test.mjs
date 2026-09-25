import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { applyAutomaticBenchSubstitutions, splitSinglesSetPoints } from "../../app/dashboard/player-types.ts";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "./fixture.mjs";

async function withFixture(t, options) {
  const fixture = await createFixture(options);
  t.after(() => cleanupFixture(fixture));
  return fixture;
}

async function points(fixture, week = fixture.weeks[0]) {
  return checked(await fixture.admin.from("fantasy_team_gameweek_points")
    .select("points").eq("fantasy_team_id", fixture.teamId)
    .eq("fantasy_gameweek_id", week.id).single(), "Read team points").points;
}

test("save RPC rejects incomplete, duplicate, over-budget and over-club squads", async (t) => {
  const f = await withFixture(t);
  const valid = squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]]);
  assert.match((await save(f, valid.slice(1))).error.message, /exactly four|six players/i);
  assert.match((await save(f, [...valid.slice(0, 5), valid[4]])).error.message, /only once/i);
  const overClub = squad([f.players[0], f.players[1], f.players[10], f.players[2], f.players[4], f.players[6]]);
  assert.match((await save(f, overClub)).error.message, /maximum of two players/i);
  checked(await f.admin.from("players").update({ price: 60000000 }).eq("id", f.players[0].id), "Raise price");
  assert.match((await save(f, valid)).error.message, /budget/i);
  checked(await f.admin.from("players").update({ price: 10000000 }).eq("id", f.players[0].id), "Restore price");
  checked(await save(f, valid), "Save valid squad");
});

test("locked snapshot preserves lineup and captain, and transfers stay closed until scored completion", async (t) => {
  const f = await withFixture(t);
  const rows = squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]], { captain: 2 });
  checked(await save(f, rows), "Save squad");
  const snapshot = await lock(f);
  assert.equal(snapshot.free_transfers_after_lock, 0);
  const lockedPlayers = checked(await f.admin.from("fantasy_team_gameweek_players")
    .select("player_id, position, is_captain, lineup_order")
    .eq("fantasy_team_id", f.teamId).eq("fantasy_gameweek_id", f.weeks[0].id)
    .order("lineup_order"), "Read locked lineup");
  assert.deepEqual(lockedPlayers.map((row) => row.player_id), rows.map((row) => row.player_id));
  assert.equal(lockedPlayers[2].is_captain, true);
  assert.match((await save(f, rows)).error.message, /closed|locked/i);
  const match = await addMatch(f);
  await addResult(f, match, { home: [f.players[0]], away: [f.players[2]] });
  checked(await f.admin.from("fantasy_gameweeks").update({ unlock_at: new Date(Date.now() - 60000).toISOString() })
    .eq("id", f.weeks[0].id), "Pass unlock time");
  const stillLocked = checked(await f.user.rpc("current_transfer_lock"), "Read transfer lock");
  assert.equal(stillLocked[0].is_locked, true);
  assert.match((await save(f, rows)).error.message, /closed|locked/i);
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Score persisted results");
  checked(await f.admin.rpc("complete_gameweek_refresh", {
    p_gameweek_id: f.weeks[0].id, p_refreshed_at: new Date().toISOString(),
  }), "Complete results");
  assert.equal(checked(await f.user.rpc("current_transfer_lock"), "Read open transfer lock")[0].is_locked, false);
});

test("scoring applies singles set difference, doubles wins, sweep, clincher, substitutions and captain multiplier exactly once", async (t) => {
  const f = await withFixture(t);
  const [a, b, c, d, e, g] = [f.players[0], f.players[1], f.players[2], f.players[3], f.players[4], f.players[6]];
  checked(await save(f, squad([a, c, e, g, b, d])), "Save squad");
  await lock(f);
  const match = await addMatch(f);
  await addResult(f, match, { home: [a], away: [c], order: 1 });
  await addResult(f, match, { home: [a], away: [d], order: 2 });
  await addResult(f, match, { home: [a, b], away: [c, d], order: 3 });
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Score gameweek");
  const stats = checked(await f.admin.from("player_match_stats").select("player_id, fantasy_points")
    .eq("match_id", match.match.id), "Read player scoring");
  const byPlayer = Object.fromEntries(stats.map((row) => [row.player_id, row.fantasy_points]));
  assert.equal(byPlayer[a.id], 20, "two singles wins and set differences, doubles, sweep, club win and doubles clincher");
  assert.equal(byPlayer[b.id], 6, "doubles win, club win and doubles clincher; no doubles set points");
  assert.equal(byPlayer[c.id], 1, "one set won in a lost singles match; no doubles set points");
  assert.equal(byPlayer[d.id], 1);
  assert.equal(await points(f), 48, "captain 40 + starter 1 + bench substitutes 6 and 1");
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Rescore gameweek");
  assert.equal(await points(f), 48, "recalculation is idempotent");
});

test("won singles use set difference and lost singles score only sets won", async (t) => {
  const f = await withFixture(t);
  const [a, b, c, d, e, g] = [f.players[0], f.players[1], f.players[2], f.players[3], f.players[4], f.players[6]];
  checked(await save(f, squad([a, c, e, g, b, d])), "Save squad");
  await lock(f);
  const wonFixture = await addMatch(f);
  await addResult(f, wonFixture, { home: [a], away: [c], homeSets: 3, awaySets: 0, order: 1 });
  await addResult(f, wonFixture, { home: [a], away: [d], homeSets: 3, awaySets: 1, order: 2 });
  await addResult(f, wonFixture, { home: [b], away: [c], homeSets: 3, awaySets: 2, order: 3 });
  const lostFixture = await addMatch(f, { homeClub: 1, awayClub: 0 });
  await addResult(f, lostFixture, { home: [c], away: [a], homeSets: 3, awaySets: 2 });
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Score mixed singles results");

  const stats = checked(await f.admin.from("player_match_stats")
    .select("match_id, fantasy_points").eq("player_id", a.id), "Read mixed singles points");
  assert.equal(stats.find((row) => row.match_id === wonFixture.match.id)?.fantasy_points, 16,
    "3-0 earns seven, 3-1 earns six, plus three for the club fixture");
  assert.equal(stats.find((row) => row.match_id === lostFixture.match.id)?.fantasy_points, 2,
    "a 2-3 loss earns two set points without a match or fixture bonus");

  const breakdown = checked(await f.user.rpc("get_my_squad_score_breakdown", {
    target_gameweek_id: f.weeks[0].id,
  }), "Read singles set breakdown").find((row) => row.player_id === a.id);
  assert.deepEqual({
    singles_sets_won: breakdown.singles_sets_won,
    singles_sets_lost: breakdown.singles_sets_lost,
    singles_set_points: breakdown.singles_set_points,
  }, { singles_sets_won: 8, singles_sets_lost: 4, singles_set_points: 7 });
  assert.deepEqual(splitSinglesSetPoints({
    singles_wins: 2,
    singles_losses: 1,
    ...breakdown,
  }), {
    wonPoints: 5,
    lostPoints: 2,
    wonSetsInWins: 6,
    lostSetsInWins: 1,
    wonSetsInLosses: 2,
    lostSetsInLosses: 3,
  });
});

test("rescoring a completed gameweek updates every locked team and leaderboard", async (t) => {
  const f = await withFixture(t);
  const guestTeamId = randomUUID();
  const guestAuth = checked(await f.admin.auth.admin.createUser({
    email: `rescore-${guestTeamId}@example.invalid`,
    password: f.password,
    email_confirm: true,
  }), "Create second manager");

  try {
    checked(await f.admin.from("fantasy_teams").insert({
      id: guestTeamId,
      user_id: guestAuth.user.id,
      name: `Rescore ${guestTeamId}`,
      onboarding_completed: true,
      created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    }), "Create second team");
    const guestUser = createClient(f.url, f.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    checked(await guestUser.auth.signInWithPassword({
      email: `rescore-${guestTeamId}@example.invalid`, password: f.password,
    }), "Sign in second manager");
    const guestFixture = { ...f, user: guestUser, teamId: guestTeamId };
    const [a, b, c, d, e, g] = [f.players[0], f.players[1], f.players[2], f.players[3], f.players[4], f.players[6]];
    const players = [a, c, e, g, b, d];
    checked(await save(f, squad(players)), "Save first locked squad");
    checked(await save(guestFixture, squad(players, { captain: 1 })), "Save second locked squad");
    await lock(f);
    const snapshotsBefore = checked(await f.admin.from("fantasy_team_gameweek_snapshots")
      .select("fantasy_team_id, team_name_at_lock, budget_at_lock, active_chip, transfer_penalty_points")
      .eq("fantasy_gameweek_id", f.weeks[0].id), "Read locked squads");
    assert.equal(snapshotsBefore.length, 2);

    const match = await addMatch(f);
    await addResult(f, match, { home: [a], away: [c] });
    await complete(f);
    const refreshedAt = checked(await f.admin.from("fantasy_gameweeks")
      .select("data_refreshed_at").eq("id", f.weeks[0].id).single(), "Read completion marker").data_refreshed_at;
    assert.ok(refreshedAt);

    checked(await f.admin.from("fantasy_team_gameweek_points").update({ points: -99 })
      .eq("fantasy_gameweek_id", f.weeks[0].id), "Simulate stale team scores");
    checked(await f.admin.from("player_match_stats").update({ fantasy_points: -99 })
      .eq("match_id", match.match.id).eq("player_id", a.id), "Simulate stale player score");
    assert.equal(checked(await f.admin.rpc("calculate_fantasy_gameweek_points", {
      target_gameweek_id: f.weeks[0].id,
    }), "Rescore completed gameweek"), 2);

    const teamScores = checked(await f.admin.from("fantasy_team_gameweek_points")
      .select("fantasy_team_id, points").eq("fantasy_gameweek_id", f.weeks[0].id), "Read rescored teams");
    assert.deepEqual(Object.fromEntries(teamScores.map((row) => [row.fantasy_team_id, row.points])), {
      [f.teamId]: 23,
      [guestTeamId]: 13,
    });
    assert.equal(checked(await f.admin.from("player_match_stats")
      .select("fantasy_points").eq("match_id", match.match.id)
      .eq("player_id", a.id).single(), "Read rescored player").fantasy_points, 11);
    const snapshotsAfter = checked(await f.admin.from("fantasy_team_gameweek_snapshots")
      .select("fantasy_team_id, team_name_at_lock, budget_at_lock, active_chip, transfer_penalty_points")
      .eq("fantasy_gameweek_id", f.weeks[0].id), "Read preserved locked squads");
    assert.deepEqual(snapshotsAfter, snapshotsBefore);
    assert.equal(checked(await f.admin.from("fantasy_gameweeks")
      .select("data_refreshed_at").eq("id", f.weeks[0].id).single(), "Read preserved completion marker")
      .data_refreshed_at, refreshedAt);

    checked(await f.admin.from("fantasy_gameweeks").update({
      first_match_starts_at: new Date(Date.now() - 60_000).toISOString(),
    }).eq("id", f.weeks[0].id), "Make completed gameweek visible");
    const leaderboard = checked(await f.user.rpc("get_global_leaderboard"), "Read updated leaderboard");
    assert.deepEqual(Object.fromEntries(leaderboard.map((row) => [row.user_id, Number(row.total_points)])), {
      [f.userId]: 23,
      [guestAuth.user.id]: 13,
    });
  } finally {
    checked(await f.admin.from("fantasy_teams").delete().eq("id", guestTeamId), "Remove second team");
    checked(await f.admin.auth.admin.deleteUser(guestAuth.user.id), "Remove second manager");
  }
});

test("two completed gameweeks keep player scores, team scores and private league totals in sync", async (t) => {
  const f = await createFixture({ gameweeks: 2 });
  const guestTeamId = randomUUID();
  const guestEmail = `two-weeks-${guestTeamId}@example.invalid`;
  let guestUserId;
  let leagueId;
  t.after(async () => {
    if (leagueId) checked(await f.admin.from("leagues").delete().eq("id", leagueId), "Remove two-week league");
    if (guestUserId) {
      checked(await f.admin.from("fantasy_teams").delete().eq("id", guestTeamId), "Remove two-week guest team");
      checked(await f.admin.auth.admin.deleteUser(guestUserId), "Remove two-week guest");
    }
    await cleanupFixture(f);
  });
  const auth = checked(await f.admin.auth.admin.createUser({
    email: guestEmail, password: f.password, email_confirm: true,
  }), "Create two-week guest");
  guestUserId = auth.user.id;
  checked(await f.admin.from("fantasy_teams").insert({
    id: guestTeamId, user_id: guestUserId, name: `Two-week guest ${guestTeamId}`,
    onboarding_completed: true, created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  }), "Create two-week guest team");
  const guestUser = createClient(f.url, f.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  checked(await guestUser.auth.signInWithPassword({ email: guestEmail, password: f.password }), "Sign in two-week guest");
  const guest = { ...f, user: guestUser, teamId: guestTeamId };
  leagueId = checked(await f.user.rpc("create_private_league", { p_name: "Two-week functional league" }), "Create two-week league");
  const inviteCode = checked(await f.admin.from("leagues").select("invite_code")
    .eq("id", leagueId).single(), "Read two-week invite code").invite_code;
  assert.equal(checked(await guestUser.rpc("join_private_league", { p_invite_code: inviteCode }),
    "Join two-week league"), leagueId);

  const [a, b, c, d, e, g, replacement] =
    [f.players[0], f.players[1], f.players[2], f.players[3], f.players[4], f.players[6], f.players[8]];
  const initial = [a, c, e, g, b, d];
  const expectedWeeks = [
    { playerPoints: [[a, 11], [c, 1]], owner: 23, guest: 13, ownerTotal: 23, guestTotal: 13 },
    { playerPoints: [[e, 11], [g, 1]], owner: 23, guest: 12, ownerTotal: 46, guestTotal: 25 },
  ];

  for (const [index, week] of f.weeks.entries()) {
    const ownerSquad = index === 0 ? squad(initial) : squad([replacement, c, e, g, b, d], { captain: 2 });
    const guestSquad = squad(initial, { captain: 1 });
    checked(await save(f, ownerSquad, null, week), `Save owner squad for week ${index + 1}`);
    checked(await save(guest, guestSquad, null, week), `Save guest squad for week ${index + 1}`);
    const snapshot = await lock(f, week);
    if (index === 1) {
      assert.equal(snapshot.transfer_count_at_lock, 1);
      assert.equal(snapshot.free_transfers_at_lock, 1);
      assert.equal(snapshot.transfer_penalty_points, 0);
    }
    const match = index === 0
      ? await addMatch(f, { week })
      : await addMatch(f, { week, homeClub: 2, awayClub: 3 });
    await addResult(f, match, index === 0 ? { home: [a], away: [c] } : { home: [e], away: [g] });
    checked(await f.admin.from("fantasy_gameweeks").update({
      first_match_starts_at: new Date(Date.now() - 60_000).toISOString(),
    }).eq("id", week.id), `Show week ${index + 1} results`);
    await complete(f, week);

    const expected = expectedWeeks[index];
    const stats = checked(await f.admin.from("player_match_stats")
      .select("player_id, fantasy_points").eq("match_id", match.match.id), `Read week ${index + 1} player scores`);
    assert.deepEqual(Object.fromEntries(stats.map((row) => [row.player_id, row.fantasy_points])),
      Object.fromEntries(expected.playerPoints.map(([player, score]) => [player.id, score])));
    for (const [account, rows, total] of [[f, ownerSquad, expected.owner], [guest, guestSquad, expected.guest]]) {
      const stored = checked(await f.admin.from("fantasy_team_gameweek_points")
        .select("points").eq("fantasy_team_id", account.teamId)
        .eq("fantasy_gameweek_id", week.id).single(), `Read week ${index + 1} team score`);
      assert.equal(stored.points, total);
      const squadResult = checked(await account.user.rpc("get_my_squad_result", { target_gameweek_id: week.id }),
        `Read week ${index + 1} squad result`);
      assert.deepEqual(squadResult.map((row) => [row.player_id, row.fantasy_points]),
        rows.map((row) => [row.player_id,
          expected.playerPoints.find(([player]) => player.id === row.player_id)?.[1] ?? 0]));
    }
    const standings = checked(await f.user.rpc("get_private_league_leaderboard", { p_league_id: leagueId }),
      `Read league after week ${index + 1}`);
    assert.deepEqual(standings.map((row) => [row.user_id, Number(row.total_points)]),
      [[f.userId, expected.ownerTotal], [guestUserId, expected.guestTotal]]);
    for (const [userId, scores] of [
      [f.userId, expectedWeeks.slice(0, index + 1).map((item) => item.owner)],
      [guestUserId, expectedWeeks.slice(0, index + 1).map((item) => item.guest)],
    ]) {
      const history = checked(await f.user.rpc("get_leaderboard_team_gameweek_points", { p_user_id: userId }),
        `Read league week history after week ${index + 1}`);
      assert.deepEqual(history.map((row) => [row.gameweek_id, row.points]),
        f.weeks.slice(0, index + 1).map((item, weekIndex) => [item.id, scores[weekIndex]]));
    }
    if (index === 1) {
      const firstWeekAfterSecond = checked(await f.admin.from("fantasy_team_gameweek_points")
        .select("fantasy_team_id, points").eq("fantasy_gameweek_id", f.weeks[0].id),
      "Read week 1 scores after week 2 completion");
      assert.deepEqual(Object.fromEntries(firstWeekAfterSecond.map((row) => [row.fantasy_team_id, row.points])), {
        [f.teamId]: 23,
        [guestTeamId]: 13,
      });
    }
  }
});

test("an absent captain is replaced by the first playing bench player, while the second stays out", async (t) => {
  const f = await withFixture(t);
  const [absentCaptain, firstBench, starterTwo, secondBench, starterThree, starterFour, opponent] =
    [f.players[0], f.players[1], f.players[2], f.players[3], f.players[4], f.players[6], f.players[8]];
  checked(await save(f, squad([absentCaptain, starterTwo, starterThree, starterFour, firstBench, secondBench])), "Save lineup");
  await lock(f);
  const firstMatch = await addMatch(f);
  await addResult(f, firstMatch, { home: [firstBench], away: [starterTwo] });
  const secondMatch = await addMatch(f, { homeClub: 2, awayClub: 3 });
  await addResult(f, secondMatch, { home: [starterThree], away: [starterFour] });
  const thirdMatch = await addMatch(f, { homeClub: 1, awayClub: 4 });
  await addResult(f, thirdMatch, { home: [secondBench], away: [opponent] });
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Score substitution");

  const rows = checked(await f.user.rpc("get_my_squad_result", { target_gameweek_id: f.weeks[0].id }), "Read squad result");
  const effective = applyAutomaticBenchSubstitutions(rows.map((row) => ({
    ...row, id: row.player_id, original_position: row.position, automatic_substitution: null,
  })));
  const byPlayer = Object.fromEntries(effective.map((player) => [player.id, player]));
  assert.equal(byPlayer[absentCaptain.id].automatic_substitution, "out");
  assert.equal(byPlayer[absentCaptain.id].team_points_contribution, 0);
  assert.equal(byPlayer[firstBench.id].automatic_substitution, "in");
  assert.equal(byPlayer[firstBench.id].is_captain, true);
  assert.equal(byPlayer[firstBench.id].fantasy_points, 11);
  assert.equal(byPlayer[firstBench.id].team_points_contribution, 22);
  assert.equal(byPlayer[secondBench.id].automatic_substitution, null);
  assert.equal(byPlayer[secondBench.id].fantasy_points, 11);
  assert.equal(byPlayer[secondBench.id].team_points_contribution, 0);
  assert.equal(await points(f), 35, "incoming captain 22 + other starters 1 + 11 + 1");
});

test("club-win bonus requires an appearance; walkover gives seven match points", async (t) => {
  const f = await withFixture(t);
  const [winner, absentClubmate, loser] = [f.players[0], f.players[1], f.players[2]];
  checked(await save(f, squad([winner, loser, f.players[4], f.players[6], absentClubmate, f.players[3]])), "Save squad before club snapshot");
  await lock(f);
  const match = await addMatch(f);
  await addResult(f, match, { home: [winner], away: [loser], walkover: true });
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Score walkover");
  const stats = checked(await f.admin.from("player_match_stats").select("player_id, fantasy_points")
    .eq("match_id", match.match.id), "Read walkover points");
  assert.equal(stats.find((row) => row.player_id === winner.id)?.fantasy_points, 12,
    "seven walkover points, three club-win points and two singles-clincher points");
  assert.equal(stats.find((row) => row.player_id === absentClubmate.id)?.fantasy_points ?? 0, 0);
});

test("free transfers count net changes, roll over, and wildcard avoids a points penalty", async (t) => {
  const f = await withFixture(t, { gameweeks: 3 });
  const first = squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]]);
  checked(await save(f, first, null, f.weeks[0]), "Save initial squad");
  await lock(f, f.weeks[0]);
  await complete(f, f.weeks[0]);
  const changed = [...first];
  changed[0] = { ...changed[0], player_id: f.players[8].id };
  checked(await save(f, changed, null, f.weeks[1]), "Save transfer");
  checked(await save(f, first, null, f.weeks[1]), "Reverse transfer");
  const second = await lock(f, f.weeks[1]);
  assert.equal(second.transfer_count_at_lock, 0);
  assert.equal(second.free_transfers_at_lock, 1);
  assert.equal(second.free_transfers_after_lock, 1);
  await complete(f, f.weeks[1]);
  const wildcard = squad([f.players[4], f.players[5], f.players[6], f.players[7], f.players[8], f.players[9]]);
  checked(await save(f, wildcard, "wildcard", f.weeks[2]), "Select wildcard");
  const third = await lock(f, f.weeks[2]);
  assert.equal(third.transfer_count_at_lock, 4);
  assert.equal(third.free_transfers_at_lock, 2);
  assert.equal(third.free_transfers_after_lock, 2);
  assert.equal(third.transfer_penalty_points, 0);
  await complete(f, f.weeks[2]);
  const chip = checked(await f.admin.from("fantasy_team_chip_selections").select("used_at")
    .eq("fantasy_team_id", f.teamId).eq("fantasy_gameweek_id", f.weeks[2].id).single(), "Read wildcard use");
  assert.ok(chip.used_at);
});

test("extra net transfers deduct four points each after the free allowance", async (t) => {
  const f = await withFixture(t, { gameweeks: 2 });
  const first = squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]]);
  checked(await save(f, first), "Save first squad");
  await lock(f);
  await complete(f);
  const second = squad([f.players[5], f.players[7], f.players[8], f.players[9], f.players[1], f.players[3]]);
  checked(await save(f, second, null, f.weeks[1]), "Save four net transfers");
  const snapshot = await lock(f, f.weeks[1]);
  assert.equal(snapshot.transfer_count_at_lock, 4);
  assert.equal(snapshot.free_transfers_at_lock, 1);
  assert.equal(snapshot.transfer_penalty_points, -12);
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[1].id }), "Score transfer cost");
  assert.equal(await points(f, f.weeks[1]), -12);
});

test("unused free transfers stop accumulating at four", async (t) => {
  const f = await withFixture(t, { gameweeks: 6 });
  const rows = squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]]);
  checked(await save(f, rows), "Save initial squad");
  for (const [index, week] of f.weeks.entries()) {
    const snapshot = await lock(f, week);
    if (index === 0) assert.equal(snapshot.free_transfers_at_lock, null);
    else assert.equal(snapshot.free_transfers_at_lock, Math.min(index, 4));
    if (index < f.weeks.length - 1) await complete(f, week);
  }
});

test("late results rescore the original locked squad after the manager transfers out a player", async (t) => {
  const f = await withFixture(t, { gameweeks: 2 });
  const first = squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]]);
  checked(await save(f, first), "Save first squad");
  await lock(f);
  await complete(f);
  const second = [...first];
  second[0] = { ...second[0], player_id: f.players[8].id };
  checked(await save(f, second, null, f.weeks[1]), "Transfer out original captain");
  const match = await addMatch(f, { week: f.weeks[0] });
  await addResult(f, match, { home: [f.players[0]], away: [f.players[2]] });
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Rescore delayed fixture");
  assert.equal(await points(f), 23, "original captain still doubles the late result, including the clincher");
  const original = checked(await f.admin.from("fantasy_team_gameweek_players")
    .select("player_id").eq("fantasy_team_id", f.teamId).eq("fantasy_gameweek_id", f.weeks[0].id), "Read original snapshot");
  assert.ok(original.some((row) => row.player_id === f.players[0].id));
});

test("triple captain triples exactly, bench boost adds both bench scores, and used chips cannot be reused", async (t) => {
  const f = await withFixture(t, { gameweeks: 2 });
  const rows = squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]]);
  checked(await save(f, rows, "triple_captain", f.weeks[0]), "Select triple captain");
  const first = await lock(f);
  assert.equal(first.active_chip, "triple_captain");
  const match = await addMatch(f);
  await addResult(f, match, { home: [f.players[0]], away: [f.players[2]] });
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Score triple captain");
  assert.equal(await points(f), 34, "captain 11 x 3 plus opponent's one set and no bench appearance");
  await complete(f);
  assert.match((await save(f, rows, "triple_captain", f.weeks[1])).error.message, /already been used/i);
  checked(await save(f, rows, "bench_boost", f.weeks[1]), "Select bench boost");
  const second = await lock(f, f.weeks[1]);
  assert.equal(second.active_chip, "bench_boost");
  const secondMatch = await addMatch(f, { week: f.weeks[1] });
  await addResult(f, secondMatch, { home: [f.players[0]], away: [f.players[2]], order: 1 });
  await addResult(f, secondMatch, { home: [f.players[1]], away: [f.players[3]], order: 2 });
  const otherMatch = await addMatch(f, { week: f.weeks[1], homeClub: 2, awayClub: 3 });
  await addResult(f, otherMatch, { home: [f.players[4]], away: [f.players[6]] });
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[1].id }), "Score bench boost");
  const playerPoints = checked(await f.admin.from("fantasy_team_gameweek_players")
    .select("player_id, fantasy_points").eq("fantasy_team_id", f.teamId)
    .eq("fantasy_gameweek_id", f.weeks[1].id), "Read boosted player points");
  const byPlayer = Object.fromEntries(playerPoints.map((player) => [player.player_id, player.fantasy_points]));
  assert.deepEqual(rows.map((player) => byPlayer[player.player_id]), [9, 1, 11, 1, 11, 1]);
  const regularStarterTotal = 9 * 2 + 1 + 11 + 1;
  const benchTotal = 11 + 1;
  assert.equal(await points(f, f.weeks[1]), 43, "all starters play; bench boost adds 12 bench points to 31 starter points");
  assert.equal((await points(f, f.weeks[1])) - regularStarterTotal, benchTotal);
});

import assert from "node:assert/strict";
import test from "node:test";
import { applyAutomaticBenchSubstitutions } from "../../app/dashboard/player-types.ts";
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

test("scoring applies singles, doubles rounding, sweep, bench substitutions and captain multiplier exactly once", async (t) => {
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
  assert.equal(byPlayer[a.id], 23, "two singles wins, sets, doubles, sweep and club win");
  assert.equal(byPlayer[b.id], 7, "doubles win, rounded set points and club win");
  assert.equal(byPlayer[c.id], 2, "lost singles and doubles sets still score");
  assert.equal(byPlayer[d.id], 2);
  assert.equal(await points(f), 57, "captain 46 + starter 2 + bench substitutes 7 and 2");
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Rescore gameweek");
  assert.equal(await points(f), 57, "recalculation is idempotent");
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
  assert.equal(byPlayer[firstBench.id].fantasy_points, 10);
  assert.equal(byPlayer[firstBench.id].team_points_contribution, 20);
  assert.equal(byPlayer[secondBench.id].automatic_substitution, null);
  assert.equal(byPlayer[secondBench.id].fantasy_points, 10);
  assert.equal(byPlayer[secondBench.id].team_points_contribution, 0);
  assert.equal(await points(f), 32, "incoming captain 20 + other starters 1 + 10 + 1");
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
  assert.equal(stats.find((row) => row.player_id === winner.id)?.fantasy_points, 10);
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
  assert.equal(await points(f), 21, "original captain still doubles the late result");
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
  assert.equal(await points(f), 31, "captain 10 x 3 plus opponent's one set and no bench appearance");
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
  assert.deepEqual(rows.map((player) => byPlayer[player.player_id]), [10, 1, 10, 1, 10, 1]);
  const regularStarterTotal = 10 * 2 + 1 + 10 + 1;
  const benchTotal = 10 + 1;
  assert.equal(await points(f, f.weeks[1]), 43, "all starters play; bench boost adds 11 bench points to 32 starter points");
  assert.equal((await points(f, f.weeks[1])) - regularStarterTotal, benchTotal);
});

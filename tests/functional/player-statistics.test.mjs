import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "./fixture.mjs";

test("unlocked player statistics aggregate singles, golden doubles and walkovers; exclude future weeks and preserve zero appearances in form", async () => {
  const f = await createFixture({ gameweeks: 7 });
  try {
    const anon = createClient(f.url, f.anonKey, { auth: { persistSession: false } });
    for (const [index, week] of f.weeks.slice(0, 6).entries()) {
      checked(await f.admin.from("fantasy_gameweeks").update({
        lock_at: new Date(Date.now() - (17 - index) * 60_000).toISOString(),
        first_match_starts_at: new Date(Date.now() - (7 - index) * 60_000).toISOString(),
      }).eq("id", week.id), "Start statistics gameweek");
    }
    const singles = { home: [f.players[0]], away: [f.players[2]] };
    const games = [];
    for (const week of f.weeks) games.push(await addMatch(f, { week }));
    await addResult(f, games[0], { ...singles, homeSets: 3, awaySets: 0 });
    await addResult(f, games[0], { ...singles, order: 2 });
    await addResult(f, games[1], { home: [f.players[0], f.players[1]], away: [f.players[2], f.players[3]], golden: true });
    // Unresolved partners still count when deciding whether a match is doubles.
    const doubles = checked(await f.admin.from("stupa_submatches").select("stupa_submatch_id").eq("match_id", games[1].match.id).single(), "Read golden doubles");
    checked(await f.admin.from("player_submatch_results").update({ player_id: null }).eq("stupa_submatch_id", doubles.stupa_submatch_id).in("player_id", [f.players[1].id, f.players[3].id]), "Leave doubles partners unresolved");
    await addResult(f, games[3], { ...singles, homeSets: 3, awaySets: 2, walkover: true });
    await addResult(f, games[4], { ...singles, homeSets: 2, awaySets: 3, walkover: true });
    await addResult(f, games[5], { ...singles, homeSets: 3, awaySets: 2 });
    const secondFixture = await addMatch(f, { week: f.weeks[5] });
    await addResult(f, secondFixture, { ...singles, homeSets: 2, awaySets: 3 });
    await addResult(f, games[6], singles); // Already stored, but the week is still in the future.
    for (const week of f.weeks) checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: week.id }), "Score statistics fixture");
    for (const week of f.weeks.slice(0, 6)) await complete(f, week);

    const history = checked(await anon.rpc("get_player_statistics_rows", { p_player_id: f.players[0].id }), "Read public statistics");
    assert.equal(history.length, 6);
    assert.deepEqual(history.map((r) => r.gameweek_id), f.weeks.slice(0, 6).toReversed().map((w) => w.id));
    const byWeek = Object.fromEntries(history.map((r) => [r.gameweek_id, r]));
    assert.equal(byWeek[f.weeks[0].id].singles_wins, 2);
    assert.equal(byWeek[f.weeks[0].id].singles_set_points, 5);
    assert.equal(byWeek[f.weeks[0].id].is_final, true);
    assert.equal(byWeek[f.weeks[1].id].doubles_wins, 1);
    assert.equal(byWeek[f.weeks[1].id].singles_sets_won, 0);
    assert.equal(byWeek[f.weeks[1].id].is_final, true);
    assert.equal(byWeek[f.weeks[2].id].fantasy_points, 0);
    assert.equal(byWeek[f.weeks[3].id].singles_sets_won, 3);
    assert.equal(byWeek[f.weeks[3].id].singles_sets_lost, 0);
    assert.equal(byWeek[f.weeks[4].id].singles_sets_won, 0);
    assert.equal(byWeek[f.weeks[4].id].singles_sets_lost, 0);
    assert.equal(byWeek[f.weeks[5].id].singles_wins, 1);
    assert.equal(byWeek[f.weeks[5].id].singles_losses, 1);
    assert.equal(byWeek[f.weeks[5].id].singles_set_points, 3);
    const split = (row) => [row.singles_won_match_sets_won, row.singles_won_match_sets_lost, row.singles_won_match_set_points, row.singles_lost_match_sets_won, row.singles_lost_match_sets_lost, row.singles_lost_match_set_points];
    assert.deepEqual(split(byWeek[f.weeks[0].id]), [6, 1, 5, 0, 0, 0]);
    assert.deepEqual(split(byWeek[f.weeks[1].id]), [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(split(byWeek[f.weeks[2].id]), [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(split(byWeek[f.weeks[3].id]), [3, 0, 3, 0, 0, 0]);
    assert.deepEqual(split(byWeek[f.weeks[4].id]), [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(split(byWeek[f.weeks[5].id]), [3, 2, 1, 2, 3, 2]);
    const summary = checked(await anon.rpc("get_transfer_players", { p_player_id: f.players[0].id }), "Read transfer summary")[0];
    assert.equal(summary.total_points, history.reduce((sum, row) => sum + row.fantasy_points, 0));
    assert.equal(summary.owned_percent, null, "Finished weeks without team snapshots have no ownership percentage");
    assert.equal(Number(summary.form), Math.round(history.slice(0, 5).reduce((sum, row) => sum + row.fantasy_points, 0) / 5 * 10) / 10);
    assert.equal(summary.singles_wins, 4);
    assert.equal(summary.singles_losses, 2);
    const catalogue = checked(await anon.rpc("get_transfer_players"), "Read complete transfer summaries");
    assert.deepEqual(catalogue.find((p) => p.id === summary.id), summary);
    assert.equal(history.some((row) => "raw_payload" in row || "user_id" in row || "team_id" in row), false);
    assert.deepEqual(checked(await anon.from("player_submatch_results").select("raw_payload").eq("player_id", summary.id), "Raw results remain private"), []);
    const noAppearances = checked(await anon.rpc("get_transfer_players", { p_player_id: f.players[10].id }), "Read unplayed player")[0];
    assert.equal(noAppearances.total_points, 0);
    assert.equal(Number(noAppearances.form), 0);
    assert.equal(noAppearances.singles_wins, 0);
    checked(await f.admin.from("players").update({ active: false }).eq("id", summary.id), "Deactivate historical player");
    assert.equal(checked(await anon.rpc("get_transfer_players"), "Read active catalogue").some((p) => p.id === summary.id), false);
    assert.equal(checked(await anon.rpc("get_transfer_players", { p_player_id: summary.id }), "Read inactive player history")[0].total_points, summary.total_points);
    assert.deepEqual(checked(await anon.rpc("get_transfer_players", { p_player_id: randomUUID() }), "Read missing player"), []);
  } finally { await cleanupFixture(f); }
});

test("players have no form before any gameweek unlocks", async () => {
  const f = await createFixture();
  try {
    const rows = checked(await f.user.rpc("get_transfer_players", { p_player_id: f.players[0].id }), "Read preseason player");
    assert.equal(rows[0].form, null);
    assert.equal(rows[0].owned_percent, null);
    assert.equal(rows[0].total_points, 0);
    assert.deepEqual(checked(await f.user.rpc("get_player_statistics_rows", { p_player_id: f.players[0].id }), "Read preseason history"), []);
  } finally { await cleanupFixture(f); }
});

test("ownership uses completed locked squads including benches, excludes incomplete teams and stays stable through transfers and live weeks", async () => {
  const f = await createFixture({ gameweeks: 3 });
  const guests = [];
  const anon = createClient(f.url, f.anonKey, { auth: { persistSession: false } });
  const ownership = async (client = anon) => checked(await client.rpc("get_player_ownership", { p_player_id: f.players[0].id }), "Read aggregate ownership")[0];
  async function addManager({ late = false } = {}) {
    const teamId = randomUUID();
    const email = `ownership-${teamId}@example.invalid`;
    const auth = checked(await f.admin.auth.admin.createUser({ email, password: f.password, email_confirm: true }), "Create ownership manager");
    const guest = { ...f, teamId, userId: auth.user.id };
    guests.push(guest);
    checked(await f.admin.from("fantasy_teams").insert({ id: teamId, user_id: guest.userId, name: `Ownership ${teamId}`, created_at: new Date(Date.now() - (late ? 0 : 60 * 60_000)).toISOString() }), "Create ownership team");
    guest.user = createClient(f.url, f.anonKey, { auth: { persistSession: false } });
    checked(await guest.user.auth.signInWithPassword({ email, password: f.password }), "Sign in ownership manager");
    return guest;
  }
  try {
    const first = await addManager();
    const second = await addManager();
    await addManager(); // An incomplete team never gets a locked squad.
    const [p0, p1, p2, p3, p4, , p6, , p8] = f.players;
    const initial = [p0, p2, p4, p6, p1, p3];
    checked(await save(f, squad(initial)), "Save owner squad");
    checked(await save(first, squad([p8, p2, p4, p6, p1, p3])), "Save first guest squad");
    checked(await save(second, squad([p0, p2, p4, p6, p1, p8])), "Save second guest squad");
    assert.equal((await ownership()).owned_percent, null);
    const firstWeek = f.weeks[0];
    await lock(f, firstWeek);
    checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - 120_000).toISOString() }).eq("id", firstWeek.id), "Start first ownership week");
    const game = await addMatch(f, { week: firstWeek });
    await addResult(f, game, { home: [p0], away: [p2] });
    assert.equal((await ownership()).owned_percent, null, "Live squads are not published as ownership");
    await complete(f, firstWeek);
    assert.deepEqual(await ownership(), { player_id: p0.id, owned_percent: 66.7 });
    assert.deepEqual(await ownership(f.user), await ownership(), "Aggregate totals include teams hidden by manager RLS");
    const all = checked(await anon.rpc("get_player_ownership"), "Read all aggregate ownership");
    assert.equal(all.find((row) => row.player_id === p1.id).owned_percent, 100, "Bench selections count as ownership");
    assert.equal(all.find((row) => row.player_id === f.players[10].id).owned_percent, 0);
    assert.equal(checked(await anon.rpc("get_transfer_players", { p_player_id: p0.id }), "Read owned catalogue player")[0].owned_percent, 66.7);
    assert.equal(checked(await anon.rpc("get_transfer_players"), "Read full ownership catalogue").find((player) => player.id === p0.id).owned_percent, 66.7);
    assert.equal(all.every((row) => Object.keys(row).sort().join(",") === "owned_percent,player_id"), true);
    assert.deepEqual(checked(await anon.from("fantasy_team_gameweek_players").select("*").eq("fantasy_gameweek_id", firstWeek.id), "Raw locked selections remain private"), []);
    await addManager({ late: true });
    const nextWeek = f.weeks[1];
    checked(await save(f, squad([p8, p2, p4, p6, p1, p3]), null, nextWeek), "Transfer after completion");
    assert.equal((await ownership()).owned_percent, 66.7, "Unsaved and current transfers cannot change previous ownership");
    await lock(f, nextWeek);
    checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", nextWeek.id), "Start next ownership week");
    const nextGame = await addMatch(f, { week: nextWeek });
    await addResult(f, nextGame, { home: [p0], away: [p2] });
    checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: nextWeek.id }), "Score live ownership week");
    assert.equal((await ownership()).owned_percent, 66.7);
    checked(await f.admin.from("fantasy_gameweeks").update({ unlock_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", nextWeek.id), "Pass unlock without completing refresh");
    assert.equal((await ownership()).owned_percent, 66.7, "Pending refresh keeps previous ownership");
    await complete(f, nextWeek);
    assert.equal((await ownership()).owned_percent, 33.3, "Successful completion publishes next locked selections");
    checked(await save(f, squad(initial), null, f.weeks[2]), "Transfer for the next open gameweek after second completion");
    assert.equal((await ownership()).owned_percent, 33.3);
    checked(await f.admin.from("players").update({ active: false }).eq("id", p0.id), "Deactivate previously owned player");
    assert.equal((await ownership()).owned_percent, 33.3, "Inactive owned players keep historical ownership");
  } finally {
    for (const guest of guests) {
      checked(await f.admin.from("fantasy_teams").delete().eq("id", guest.teamId), "Remove ownership guest team");
      checked(await f.admin.auth.admin.deleteUser(guest.userId), "Remove ownership guest manager");
    }
    await cleanupFixture(f);
  }
});

test("statistics and transfer summaries publish only after successful unlock, including when live scores already exist", async () => {
  const f = await createFixture({ gameweeks: 2 });
  try {
    checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save statistics visibility squad");
    const id = f.players[0].id;
    const history = async () => checked(await f.user.rpc("get_player_statistics_rows", { p_player_id: id }), "Read published history");
    const summary = async () => checked(await f.user.rpc("get_transfer_players", { p_player_id: id }), "Read published transfer summary")[0];
    for (const [index, week] of f.weeks.entries()) {
      await lock(f, week);
      checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - (2 - index) * 60_000).toISOString() }).eq("id", week.id), "Start statistics visibility week");
      const beforeHistory = await history();
      const beforeSummary = await summary();
      const game = await addMatch(f, { week });
      await addResult(f, game, { home: [f.players[0]], away: [f.players[2]] });
      checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: week.id }), "Score during locked week");
      const stored = checked(await f.admin.from("player_match_stats").select("fantasy_points").eq("player_id", id).eq("match_id", game.match.id).single(), "Verify live points were persisted");
      assert.ok(stored.fantasy_points > 0);
      assert.deepEqual(await history(), beforeHistory, "In-progress results cannot change published history");
      assert.deepEqual(await summary(), beforeSummary, "In-progress results cannot change transfer statistics");
      assert.equal(checked(await f.admin.rpc("complete_gameweek_refresh", { p_gameweek_id: week.id, p_refreshed_at: new Date().toISOString() }), "Attempt refresh completion before unlock"), false);
      assert.deepEqual(await history(), beforeHistory, "Rejected early completion cannot publish statistics");
      await addResult(f, game, { home: [f.players[0]], away: [f.players[2]], order: 2, homeSets: 3, awaySets: 0 });
      checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: week.id }), "Score additional live result");
      assert.deepEqual(await history(), beforeHistory);
      checked(await f.admin.from("fantasy_gameweeks").update({ unlock_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", week.id), "Pass unlock time without completing refresh");
      assert.equal(checked(await f.user.rpc("current_transfer_lock"), "Read pending refresh lock")[0].is_refreshing, true);
      assert.deepEqual(await history(), beforeHistory, "Passing the deadline is insufficient without successful refresh");
      assert.deepEqual(await summary(), beforeSummary);
      await complete(f, week);
      const published = await history();
      assert.equal(published.length, index + 1);
      assert.equal(published[0].gameweek_id, week.id);
      assert.equal(published[0].singles_wins, 2);
      assert.equal(published.every((row) => row.is_final), true);
      assert.equal((await summary()).total_points, published.reduce((sum, row) => sum + row.fantasy_points, 0));
      assert.ok((await summary()).total_points > beforeSummary.total_points);
    }
  } finally { await cleanupFixture(f); }
});

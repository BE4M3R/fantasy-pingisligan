import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { buildImportRows, persistScoreAndComplete } from "../../scripts/import-stupa-results.mjs";
import { persistStupaResults } from "../../scripts/persist-stupa-results.mjs";
import { addMatch, addResult, checked, cleanupFixture, createFixture, lock, save, squad } from "./fixture.mjs";

async function setup(t) {
  const f = await createFixture({ gameweeks: 2 });
  t.after(() => cleanupFixture(f));
  checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save squad");
  await lock(f);
  const game = await addMatch(f);
  const other = await addMatch(f, { week: f.weeks[1] });
  await addResult(f, other, { home: [f.players[0]], away: [f.players[2]] });
  const sourceId = randomInt(100000000, 900000000);
  const source = (offset) => ({
    id: sourceId,
    status: "SCORED", winner: game.homeId,
    participants: [
      { order: 1, participant_id: game.homeId },
      { order: 2, participant_id: game.awayId },
    ],
    sub_matches: Array.from({ length: 9 }, (_, index) => {
      const golden = index === 8;
      const homeWon = golden || index % 2 === 0;
      return {
        id: sourceId + offset + index + 1,
        order: golden ? 1 : index + 1, is_golden_match: golden,
        status: "SCORED", winner: homeWon ? game.homeId : game.awayId,
        participants: [
          { participant_id: game.homeId, order: 1, sets_won: homeWon ? 3 : 1,
            sets_lost: homeWon ? 1 : 3, players: golden ? f.players.slice(0, 2) : [f.players[index % 2]] },
          { participant_id: game.awayId, order: 2, sets_won: homeWon ? 1 : 3,
            sets_lost: homeWon ? 3 : 1, players: golden ? f.players.slice(2, 4) : [f.players[2 + index % 2]] },
        ].map(({ players, ...side }) => ({ ...side,
          participant_details: players.map((p) => ({ user_role_id: p.stupa_user_role_id,
            name: `${p.first_name} ${p.last_name}` })),
        })),
      };
    }),
  });
  const rows = (offset) => buildImportRows([source(offset)],
    new Map([[sourceId, game.match]]), new Map(),
    new Map(f.players.map((p) => [String(p.stupa_user_role_id), p])));
  return { f, game, other, rows };
}

async function state(f, game) {
  const submatches = checked(await f.admin.from("stupa_submatches").select("*")
    .eq("match_id", game.match.id).order("stupa_submatch_id"), "Read individual matches");
  const results = submatches.length ? checked(await f.admin.from("player_submatch_results").select("*")
    .in("stupa_submatch_id", submatches.map((s) => s.stupa_submatch_id))
    .order("stupa_submatch_id").order("stupa_user_role_id"), "Read player results") : [];
  const stats = checked(await f.admin.from("player_match_stats")
    .select("player_id, fantasy_points, won_matches, lost_matches, won_sets, lost_sets")
    .eq("match_id", game.match.id).order("player_id"), "Read player scores");
  const totals = checked(await f.admin.from("fantasy_team_gameweek_points").select("fantasy_team_id, points")
    .eq("fantasy_gameweek_id", f.weeks[0].id).order("fantasy_team_id"), "Read team totals");
  const summary = checked(await f.user.rpc("get_gameweek_matches", { p_gameweek_id: game.match.fantasy_gameweek_id }), "Read match summary")
    .find((row) => row.id === game.match.id);
  return { submatches, results, stats, totals, score: [summary.home_score, summary.away_score] };
}

test("STUPA replacement IDs preserve 5–4 and fantasy scores, repair existing 10–8, and remain idempotent", async (t) => {
  const { f, game, other, rows } = await setup(t);
  const lineupColumns = "fantasy_team_id, fantasy_gameweek_id, player_id, position, is_captain, price_at_lock, club_id_at_lock, player_first_name_at_lock, player_last_name_at_lock, club_name_at_lock, lineup_order, created_at";
  const snapshots = checked(await f.admin.from("fantasy_team_gameweek_players").select(lineupColumns)
    .eq("fantasy_gameweek_id", f.weeks[0].id).order("player_id"), "Read original locked squad");
  const unrelated = await state(f, other);
  const original = rows(0);
  await persistScoreAndComplete(f.admin, original);
  const baseline = await state(f, game);
  assert.deepEqual(baseline.score, [5, 4]);
  assert.equal(baseline.submatches.length, 9);
  assert.equal(baseline.results.length, 20);

  // Emulate the old production importer having appended a republished set.
  const replacement = rows(100);
  checked(await f.admin.from("stupa_submatches").upsert(replacement.submatches), "Emulate old importer submatches");
  checked(await f.admin.from("player_submatch_results")
    .upsert(replacement.playerResults, { onConflict: "stupa_submatch_id,stupa_user_role_id" }), "Emulate old importer results");
  checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Score duplicate results");
  const duplicated = await state(f, game);
  assert.deepEqual(duplicated.score, [10, 8]);
  assert.ok(Number(duplicated.totals[0].points) > Number(baseline.totals[0].points));

  await persistScoreAndComplete(f.admin, replacement);
  const repaired = await state(f, game);
  assert.deepEqual(repaired.score, [5, 4]);
  assert.equal(repaired.submatches.length, 9);
  assert.equal(repaired.results.length, 20);
  assert.deepEqual(repaired.stats, baseline.stats);
  assert.deepEqual(repaired.totals, baseline.totals);
  assert.equal(checked(await f.admin.from("player_submatch_results").select("id")
    .in("stupa_submatch_id", original.submatches.map((s) => s.stupa_submatch_id)), "Read obsolete player results").length, 0);
  await persistScoreAndComplete(f.admin, replacement);
  assert.deepEqual(await state(f, game), repaired, "Retry changes no stored result or score");

  // A future ID replacement must also avoid the problem from a clean state.
  await persistScoreAndComplete(f.admin, rows(200));
  const replacedAgain = await state(f, game);
  assert.deepEqual(replacedAgain.score, [5, 4]);
  assert.equal(replacedAgain.submatches.length, 9);
  assert.deepEqual(replacedAgain.stats, baseline.stats);
  assert.deepEqual(replacedAgain.totals, baseline.totals);
  const otherAfter = await state(f, other);
  assert.deepEqual(otherAfter.submatches, unrelated.submatches);
  assert.deepEqual(otherAfter.results, unrelated.results);
  assert.deepEqual(checked(await f.admin.from("fantasy_team_gameweek_players").select(lineupColumns)
    .eq("fantasy_gameweek_id", f.weeks[0].id).order("player_id"), "Read preserved locked squad"), snapshots);
});

test("partial and empty result batches preserve unobserved positions; golden order 1 is separate from singles order 1", async (t) => {
  const { f, game, rows } = await setup(t);
  await persistScoreAndComplete(f.admin, rows(0));
  const replacement = rows(100);
  const submatches = replacement.submatches.filter((s) => s.match_order === 1);
  const results = replacement.playerResults.filter((r) => submatches.some((s) => s.stupa_submatch_id === r.stupa_submatch_id));
  assert.equal(await persistStupaResults(f.admin, submatches, results), 2);
  let current = await state(f, game);
  assert.deepEqual(current.score, [5, 4]);
  assert.equal(current.submatches.length, 9);
  assert.equal(current.results.length, 20);
  assert.equal(current.submatches.filter((s) => s.match_order === 1).length, 2);
  const before = current;
  assert.equal(await persistStupaResults(f.admin, [], []), 0);
  current = await state(f, game);
  assert.deepEqual(current, before);
});

test("invalid replacement rolls back old results and cannot score or reopen transfers; ambiguous positions fail closed", async (t) => {
  const { f, game, rows } = await setup(t);
  await persistScoreAndComplete(f.admin, rows(0));
  const before = await state(f, game);
  const invalid = rows(100);
  invalid.playerResults[0].player_id = randomUUID();
  await assert.rejects(persistScoreAndComplete(f.admin, invalid, {
    complete: true, refreshStartedAt: new Date().toISOString(), stageId: f.weeks[0].stupa_stage_id,
  }), /foreign key/i);
  assert.deepEqual(await state(f, game), before);
  assert.equal(checked(await f.user.rpc("current_transfer_lock"), "Read transfers after failure")[0].is_locked, true);
  const ambiguous = rows(100);
  ambiguous.submatches.push({ ...ambiguous.submatches[0], stupa_submatch_id: ambiguous.submatches[0].stupa_submatch_id + 1000 });
  await assert.rejects(persistScoreAndComplete(f.admin, ambiguous), /Ambiguous Stupa results/);
  assert.deepEqual(await state(f, game), before);
});

test("correcting participants removes obsolete player rows even when STUPA keeps the same child ID", async (t) => {
  const { f, game, rows } = await setup(t);
  const original = rows(0);
  await persistScoreAndComplete(f.admin, original);
  const corrected = structuredClone(original);
  const result = corrected.playerResults[0];
  const oldRole = result.stupa_user_role_id;
  result.player_id = f.players[1].id;
  result.stupa_user_role_id = f.players[1].stupa_user_role_id;
  result.player_name = `${f.players[1].first_name} ${f.players[1].last_name}`;
  await persistStupaResults(f.admin, corrected.submatches, corrected.playerResults);
  const current = await state(f, game);
  assert.equal(current.results.length, 20);
  assert.equal(current.results.some((r) => r.stupa_submatch_id === result.stupa_submatch_id && r.stupa_user_role_id === oldRole), false);
});

test("ordinary clients cannot invoke trusted Stupa result reconciliation", async (t) => {
  const { f, game, rows } = await setup(t);
  const batch = rows(0);
  const anon = createClient(f.url, f.anonKey, { auth: { persistSession: false } });
  for (const client of [anon, f.user]) {
    await assert.rejects(persistStupaResults(client, batch.submatches, batch.playerResults), /permission denied/i);
  }
  assert.equal((await state(f, game)).submatches.length, 0);
});

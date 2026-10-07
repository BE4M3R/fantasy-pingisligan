import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { persistSchedule } from "../../scripts/import-stupa-schedule.mjs";
import { addMatch, addResult, checked, cleanupFixture, createFixture } from "./fixture.mjs";

function scheduledMatch(id, week, startsAt, home, away) {
  return {
    id,
    round_id: week.stupa_round_id,
    round: { name: week.name, order: week.round_order },
    start_time: startsAt,
    end_time: new Date(Date.parse(startsAt) + 3 * 60 * 60_000).toISOString(),
    status: "scheduled",
    participants: [
      { order: 1, participant_id: id + 1, participant_name: home },
      { order: 2, participant_id: id + 2, participant_name: away },
    ],
  };
}

test("schedule refresh updates home fixtures without mixing gameweeks or duplicating matches", async () => {
  const fixture = await createFixture({ gameweeks: 2 });
  try {
    const stageId = fixture.weeks[0].stupa_stage_id;
    const matchId = randomInt(100000000, 1000000000);
    const firstStart = new Date(Date.now() + 120 * 60_000).toISOString();
    const secondStart = new Date(Date.now() + 180 * 60_000).toISOString();
    const otherWeekStart = new Date(Date.now() + 300 * 60_000).toISOString();
    const initialSchedule = [
      scheduledMatch(matchId, fixture.weeks[0], firstStart, fixture.clubs[0].name, fixture.clubs[1].name),
      scheduledMatch(matchId + 10, fixture.weeks[0], secondStart, fixture.clubs[2].name, fixture.clubs[3].name),
      scheduledMatch(matchId + 20, fixture.weeks[1], otherWeekStart, fixture.clubs[3].name, fixture.clubs[4].name),
    ];
    const anon = createClient(fixture.url, fixture.anonKey, { auth: { persistSession: false } });
    const readWeek = (week) => anon.rpc("get_gameweek_matches", { p_gameweek_id: week.id });

    await persistSchedule(fixture.admin, initialSchedule, stageId);
    let rows = checked(await readWeek(fixture.weeks[0]), "Read upcoming home gameweek");
    assert.deepEqual(rows.map((row) => row.stupa_match_id), [matchId, matchId + 10]);
    assert.equal(rows[0].home_team_name, fixture.clubs[0].name);
    assert.equal(rows[0].away_team_name, fixture.clubs[1].name);
    assert.equal(Date.parse(rows[0].starts_at), Date.parse(firstStart));
    assert.equal(Date.parse(rows[1].starts_at), Date.parse(secondStart));
    assert.deepEqual(checked(await readWeek(fixture.weeks[1]), "Read next gameweek")
      .map((row) => row.stupa_match_id), [matchId + 20]);

    const revisedStart = new Date(Date.parse(firstStart) + 30 * 60_000).toISOString();
    await persistSchedule(fixture.admin, [
      scheduledMatch(matchId, fixture.weeks[0], revisedStart, fixture.clubs[4].name, fixture.clubs[0].name),
      ...initialSchedule.slice(1),
    ], stageId);
    rows = checked(await readWeek(fixture.weeks[0]), "Read refreshed home gameweek");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].stupa_match_id, matchId);
    assert.equal(Date.parse(rows[0].starts_at), Date.parse(revisedStart));
    assert.equal(rows[0].home_team_name, fixture.clubs[4].name);
    assert.equal(rows[0].away_team_name, fixture.clubs[0].name);
    assert.deepEqual(checked(await readWeek(fixture.weeks[1]), "Read unchanged next gameweek")
      .map((row) => row.stupa_match_id), [matchId + 20]);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("public match summaries count singles and golden doubles once, isolate the gameweek and protect raw data", async () => {
  const fixture = await createFixture({ gameweeks: 2 });
  try {
    const game = await addMatch(fixture);
    const other = await addMatch(fixture, { week: fixture.weeks[1] });
    const args = { home: [fixture.players[0]], away: [fixture.players[2]] };
    await addResult(fixture, game, args);
    await addResult(fixture, game, { ...args, order: 2, homeSets: 1, awaySets: 3 });
    await addResult(fixture, game, { home: [fixture.players[0], fixture.players[1]],
      away: [fixture.players[2], fixture.players[3]], order: 7, golden: true });
    await addResult(fixture, other, args);
    const anon = createClient(fixture.url, fixture.anonKey, { auth: { persistSession: false } });
    let rows = checked(await anon.rpc("get_gameweek_matches", { p_gameweek_id: fixture.weeks[0].id }), "Read public summaries");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, game.match.id);
    assert.equal(rows[0].home_score, 2);
    assert.equal(rows[0].away_score, 1);
    assert.equal(rows[0].status, "scored");
    assert.equal("raw_payload" in rows[0], false);
    assert.deepEqual(checked(await anon.from("stupa_submatches").select("raw_payload").eq("match_id", game.match.id), "Read protected raw rows"), []);
    checked(await fixture.admin.from("matches").update({ status: "in_progress" }).eq("id", game.match.id), "Publish live status");
    rows = checked(await anon.rpc("get_gameweek_matches", { p_gameweek_id: fixture.weeks[0].id }), "Read live summary");
    assert.equal(rows[0].status, "in_progress");
    const empty = await addMatch(fixture);
    rows = checked(await anon.rpc("get_gameweek_matches", { p_gameweek_id: fixture.weeks[0].id }), "Read unscored fixture");
    assert.equal(rows.find((row) => row.id === empty.match.id).home_score, 0);
    assert.equal(rows.find((row) => row.id === empty.match.id).away_score, 0);
  } finally {
    await cleanupFixture(fixture);
  }
});

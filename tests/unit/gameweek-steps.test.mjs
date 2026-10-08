import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { gameweekWindowTimes, individualMatchEvents, kickoff, nextIndividualMatch } from "../../scripts/staging-gameweek-test.mjs";

test("individual match events interleave simultaneous fixtures and preserve singles/doubles order", () => {
  const definition = { key: "gw1", fixtures: [
    { key: "a", matchId: -1, matches: [{ submatchId: -11 }, { submatchId: -12 }] },
    { key: "b", matchId: -2, resultAvailableFromGameweek: "gw2", matches: [{ submatchId: -21 }, { submatchId: -22 }] },
    { key: "c", matchId: -3, matches: [{ submatchId: -31 }] },
  ] };
  const starts = ["2026-10-24T18:00:00Z", "2026-10-24T18:00:00Z", "2026-10-25T19:00:00Z"];
  const rows = starts.map((start, index) => ({ stupa_match_id: -index - 1, starts_at: start,
    ends_at: new Date(Date.parse(start) + 120 * 60000).toISOString() }));
  const events = individualMatchEvents(definition, rows);
  assert.deepEqual(events.map((event) => event.match.submatchId), [-11, -21, -12, -22, -31]);
  assert.deepEqual(events.map((event) => event.available), [true, false, true, false, true]);
  assert.equal(events[0].at, Date.parse(starts[0]) + 60 * 60000);
  assert.equal(events.at(-1).at, Date.parse(starts[2]) + 120 * 60000);
  assert.throws(() => individualMatchEvents(definition, rows.slice(1)), /Missing database fixture/);
  assert.throws(() => individualMatchEvents(definition, rows.map((row) => ({ ...row, ends_at: row.starts_at }))), /Invalid fixture times/);
  assert.throws(() => individualMatchEvents({ ...definition, fixtures: definition.fixtures.map((fixture) => ({
    ...fixture, matches: [{ submatchId: -11 }],
  })) }, rows), /IDs must be unique/);
});

test("individual event times follow the installed multi-day Stockholm schedule across DST", () => {
  const definition = { key: "gw1", fixtures: [
    { key: "a", matchId: -1, startsAfterMinutes: 0, durationMinutes: 120, matches: [{ submatchId: -11 }] },
    { key: "b", matchId: -2, startsAfterMinutes: 1440, durationMinutes: 120, matches: [{ submatchId: -21 }] },
  ] };
  for (const lockAt of ["2026-03-28T15:00:00Z", "2026-10-24T15:00:00Z"]) {
    const times = gameweekWindowTimes(definition, lockAt);
    const events = individualMatchEvents(definition, times.fixtures.map((fixture) => ({
      stupa_match_id: fixture.definition.matchId, starts_at: fixture.startsAt, ends_at: fixture.endsAt,
    })));
    assert.equal(events[0].at, Date.parse(times.fixtures[0].endsAt));
    assert.equal(events[1].at, Date.parse(times.fixtures[1].endsAt));
    assert.notEqual(events[1].at - events[0].at, 24 * 60 * 60000);
  }
});

test("individual controls reject hosted targets before reading credentials or querying data", async () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const action of ["kickoff", "next-match"]) {
    const result = spawnSync(process.execPath, ["scripts/staging-gameweek-test.mjs", "--env", "staging", action, "gw1"], { encoding: "utf8", env });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /available only for local Supabase/);
  }
  const hosted = { supabaseUrl: "https://example.supabase.co", from: () => assert.fail("Must not query hosted data") };
  await assert.rejects(kickoff(hosted, {}, {}), /require local Supabase/);
  await assert.rejects(nextIndividualMatch(hosted, {}, {}), /require local Supabase/);
  const help = spawnSync(process.execPath, ["scripts/staging-gameweek-test.mjs", "--env", "local", "help"], { encoding: "utf8", env });
  assert.ifError(help.error);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /next-match gw1: complete one singles\/doubles result/);
});

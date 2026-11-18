import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { initializeBuckets, normalizeSchedule, medianTimestamp, midpointBoundary, stockholmWeek, fixturePeriod, validatePeriods } from "../../scripts/gameweek-buckets.mjs";
import { preserveLockedGameweekBoundaries } from "../../scripts/import-stupa-schedule.mjs";

const schedule = JSON.parse(await readFile(new URL("../fixtures/stupa-bucket-schedule.json", import.meta.url), "utf8"));
const normalized = normalizeSchedule(schedule, 5727);
const periods = initializeBuckets(normalized, 5727);

test("2026/27 STUPA schedule reproduces all four assignments and cutover dates", () => {
  for (const [id, expected] of [[89006, 2], [88995, 7], [89009, 10], [89016, 11]])
    assert.equal(fixturePeriod(normalized.find(m => m.stupa_match_id === id).starts_at, periods).round_order, expected);
  for (const [round, start] of [[6,"2026-11-27T23:00:00.000Z"],[7,"2026-12-11T23:00:00.000Z"],[8,"2026-12-29T23:00:00.000Z"]])
    assert.equal(periods.find(p => p.round_order === round).bucket_starts_at, start);
  assert.equal(periods[0].bucket_starts_at,null); assert.equal(periods.at(-1).bucket_ends_at,null);
});
test("dominant-week anchors ignore outliers and average even medians", () => {
  assert.equal(periods.find(p => p.round_order === 13).anchor_week,"2027-03-08");
  assert.equal(periods.find(p => p.round_order === 10).anchor_at,"2027-02-10T17:15:00.000Z");
  assert.equal(medianTimestamp(["2026-12-08T18:30:00Z","2026-12-08T18:00:00Z"]),"2026-12-08T18:15:00.000Z");
  assert.equal(medianTimestamp(["2026-12-08T19:00:00Z","2026-12-08T18:00:00Z","2026-12-08T18:30:00Z"]),"2026-12-08T18:30:00.000Z");
});
test("ambiguous, conflicting, reversed and missing anchors fail with context", () => {
  const fixture = (round, starts) => ({stupa_match_id:starts,stupa_round_id:round,round_order:round,round_name:`GW${round}`,starts_at:starts,status:"scheduled"});
  assert.throws(() => initializeBuckets([fixture(1,"2026-12-08T18:00Z"),fixture(1,"2026-12-15T18:00Z")],-1), /Ambiguous anchor.*GW1/);
  assert.throws(() => initializeBuckets([fixture(1,"2026-12-08T18:00Z"),fixture(2,"2026-12-09T18:00Z")],-1), /Conflicting/);
  assert.throws(() => initializeBuckets([fixture(2,"2026-12-08T18:00Z"),fixture(1,"2026-12-15T18:00Z")],-1), /non-chronological/);
  assert.throws(() => initializeBuckets([{...fixture(1,null),status:"postponed"}],-1), /Ambiguous/);
});
test("Stockholm weeks and midnight rounding handle DST and ties", () => {
  assert.equal(stockholmWeek("2026-09-20T22:00:00Z"),"2026-09-21");
  assert.equal(midpointBoundary("2026-12-01T10:00:00Z","2026-12-01T12:00:00Z"),"2026-12-01T23:00:00.000Z");
  assert.equal(midpointBoundary("2026-03-29T10:00:00Z","2026-03-29T11:00:00Z"),"2026-03-29T22:00:00.000Z");
  assert.equal(midpointBoundary("2026-10-25T10:00:00Z","2026-10-25T11:00:00Z"),"2026-10-25T23:00:00.000Z");
  assert.throws(() => midpointBoundary("2026-12-02T00:00Z","2026-12-01T00:00Z"), /strictly/);
});
test("exclusive boundaries do not split playing dates; invalid periods fail", () => {
  const boundary=periods[6].bucket_starts_at;
  assert.equal(fixturePeriod(new Date(Date.parse(boundary)-1).toISOString(),periods).round_order,6);
  assert.equal(fixturePeriod(boundary,periods).round_order,7);
  assert.equal(fixturePeriod("2026-12-12T22:59:59Z",periods).round_order,7);
  for (const invalid of [
    [{bucket_starts_at:null,bucket_ends_at:"2026-12-01Z"},{bucket_starts_at:"2026-12-02Z",bucket_ends_at:null}],
    [{bucket_starts_at:"2026-12-01Z",bucket_ends_at:"2026-12-01Z"}],
    [{bucket_starts_at:null,bucket_ends_at:null},{bucket_starts_at:null,bucket_ends_at:null}],
  ]) assert.throws(() => validatePeriods(invalid), /Invalid/);
});
test("unfinished locked deadlines stay fixed; reopening changes; finished lifecycle stays fixed", () => {
  const old={stupa_round_id:1,lock_at:"2026-12-01T12:00Z",unlock_at:"2026-12-02T00:00Z"};
  const proposed={...old,lock_at:"2026-12-03T12:00Z",unlock_at:"2026-12-04T00:00Z"};
  const [unfinished]=preserveLockedGameweekBoundaries([proposed],[old],"2026-12-02T12:00Z");
  assert.equal(unfinished.lock_at,old.lock_at); assert.equal(unfinished.unlock_at,proposed.unlock_at);
  const [finished]=preserveLockedGameweekBoundaries([proposed],[{...old,data_refreshed_at:"2026-12-02T01:00Z"}],"2026-12-02T12:00Z");
  assert.equal(finished.unlock_at,old.unlock_at);
});
test("undated official postponements remain; unknown statuses and ordinary missing dates fail", () => {
  const fixture={id:1,round_id:1,round:{name:"Round 1",order:1},status:"POSTPONED"};
  assert.equal(normalizeSchedule([fixture],-1)[0].starts_at,null);
  assert.throws(() => normalizeSchedule([{...fixture,status:"MYSTERY"}],-1), /unsupported STUPA status/);
  assert.throws(() => normalizeSchedule([{...fixture,status:"NOT_STARTED"}],-1), /missing confirmed/);
});

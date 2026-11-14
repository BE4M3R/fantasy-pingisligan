import assert from "node:assert/strict";
import test from "node:test";
import { groupFixturesByGameweek } from "../../lib/fixture-schedule.ts";

const weeks = [{ id: "gw5", stupa_round_id: 5 }, { id: "gw12", stupa_round_id: 12 }];

test("the schedule follows latest STUPA rounds while preserving fantasy scoring links", () => {
  const outward = { id: "outward", fantasy_gameweek_id: "gw12", stupa_round_id: 5 };
  const returning = { id: "return", fantasy_gameweek_id: "gw5", stupa_round_id: 12 };
  const groups = groupFixturesByGameweek([outward, returning], weeks);
  assert.deepEqual(groups.get("gw5"), [outward]);
  assert.deepEqual(groups.get("gw12"), [returning]);
  assert.equal(returning.fantasy_gameweek_id, "gw5");
  assert.equal(outward.fantasy_gameweek_id, "gw12");
});

test("fixtures without a known upstream round fall back to their fantasy gameweek", () => {
  const fixtures = [null, 999].map((round) => ({ fantasy_gameweek_id: "gw5", stupa_round_id: round }));
  const groups = groupFixturesByGameweek(fixtures, weeks);
  assert.deepEqual(groups.get("gw5"), fixtures);
});

test("upstream rounds can display unassigned fixtures and keep kickoff ordering", () => {
  const fixtures = [1, 2].map((id) => ({ id, fantasy_gameweek_id: null, stupa_round_id: 5 }));
  assert.deepEqual(groupFixturesByGameweek(fixtures, weeks).get("gw5"), fixtures);
});

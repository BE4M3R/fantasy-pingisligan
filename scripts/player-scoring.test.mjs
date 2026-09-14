import assert from "node:assert/strict";
import test from "node:test";

import { calculateFixtureWinPoints } from "../app/dashboard/player-types.ts";

test("a non-participant never shows the RPC's club-wide fixture bonus", () => {
  assert.equal(calculateFixtureWinPoints({
    fantasy_points: 0,
    match_win_points: 0,
    set_points: 0,
    sweep_bonus_points: 0,
  }), 0);
});

test("the breakdown derives one participating fixture win from scored points", () => {
  assert.equal(calculateFixtureWinPoints({
    fantasy_points: 10,
    match_win_points: 4,
    set_points: 3,
    sweep_bonus_points: 0,
  }), 3);
});

test("the breakdown supports appearances in multiple winning fixtures", () => {
  assert.equal(calculateFixtureWinPoints({
    fantasy_points: 20,
    match_win_points: 8,
    set_points: 6,
    sweep_bonus_points: 0,
  }), 6);
});

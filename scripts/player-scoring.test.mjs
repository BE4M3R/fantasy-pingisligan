import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAutomaticBenchSubstitutions,
  calculateFixtureWinPoints,
} from "../app/dashboard/player-types.ts";

function squadResult({
  chip = null,
  captain = false,
  id,
  played = false,
  points = 0,
  position,
}) {
  return {
    active_chip: chip,
    automatic_substitution: null,
    captain_bonus_points: 0,
    counts_for_team: position === "starter",
    doubles_losses: 0,
    doubles_wins: 0,
    fantasy_points: points,
    id,
    is_captain: captain,
    original_position: position,
    position,
    singles_losses: 0,
    singles_wins: played ? 1 : 0,
    team_points_contribution: position === "starter" ? points : 0,
  };
}

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

test("an automatically substituted captain transfers captaincy to the paired bench player", () => {
  const lockedSnapshot = [
    squadResult({ id: "absent-first", position: "starter" }),
    squadResult({ captain: true, id: "absent-captain", position: "starter" }),
    squadResult({ id: "starter-three", played: true, points: 2, position: "starter" }),
    squadResult({ id: "starter-four", played: true, points: 3, position: "starter" }),
    squadResult({ id: "bench-first", played: true, points: 5, position: "bench" }),
    squadResult({ id: "bench-second", played: true, points: 7, position: "bench" }),
  ];
  const originalSnapshot = structuredClone(lockedSnapshot);

  const effectiveLineup = applyAutomaticBenchSubstitutions(lockedSnapshot);
  const effectiveCaptain = effectiveLineup.filter((player) => player.is_captain);
  const absentCaptain = effectiveLineup.find((player) => player.id === "absent-captain");

  assert.deepEqual(lockedSnapshot, originalSnapshot);
  assert.deepEqual(effectiveCaptain.map((player) => player.id), ["bench-second"]);
  assert.equal(effectiveCaptain[0].automatic_substitution, "in");
  assert.equal(effectiveCaptain[0].captain_bonus_points, 7);
  assert.equal(effectiveCaptain[0].team_points_contribution, 14);
  assert.equal(absentCaptain.automatic_substitution, "out");
  assert.equal(absentCaptain.team_points_contribution, 0);
});

test("a transferred triple captain keeps the triple multiplier", () => {
  const effectiveLineup = applyAutomaticBenchSubstitutions([
    squadResult({ captain: true, chip: "triple_captain", id: "captain", position: "starter" }),
    squadResult({ chip: "triple_captain", id: "starter-two", played: true, position: "starter" }),
    squadResult({ chip: "triple_captain", id: "starter-three", played: true, position: "starter" }),
    squadResult({ chip: "triple_captain", id: "starter-four", played: true, position: "starter" }),
    squadResult({ chip: "triple_captain", id: "bench-first", played: true, points: 7, position: "bench" }),
    squadResult({ chip: "triple_captain", id: "bench-second", position: "bench" }),
  ]);
  const captain = effectiveLineup.find((player) => player.is_captain);

  assert.equal(captain.id, "bench-first");
  assert.equal(captain.captain_bonus_points, 14);
  assert.equal(captain.team_points_contribution, 21);
});

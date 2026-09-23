import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAutomaticBenchSubstitutions,
  calculateFixtureWinPoints,
  splitSinglesSetPoints,
} from "../../app/dashboard/player-types.ts";

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

test("the breakdown uses the explicit fixture-win component", () => {
  assert.equal(calculateFixtureWinPoints({ fixture_win_points: 0 }), 0);
  assert.equal(calculateFixtureWinPoints({ fixture_win_points: 3 }), 3);
  assert.equal(calculateFixtureWinPoints({ fixture_win_points: 6 }), 6);
});

test("singles set points split between won and lost matches", () => {
  assert.deepEqual(splitSinglesSetPoints({
    singles_wins: 1,
    singles_losses: 1,
    singles_sets_won: 5,
    singles_sets_lost: 3,
    singles_set_points: 5,
  }), {
    wonPoints: 3,
    lostPoints: 2,
    wonSetsInWins: 3,
    lostSetsInWins: 0,
    wonSetsInLosses: 2,
    lostSetsInLosses: 3,
  });
});

test("walkover losses contribute no set points", () => {
  assert.deepEqual(splitSinglesSetPoints({
    singles_wins: 0,
    singles_losses: 1,
    singles_sets_won: 0,
    singles_sets_lost: 0,
    singles_set_points: 0,
  }), {
    wonPoints: 0,
    lostPoints: 0,
    wonSetsInWins: 0,
    lostSetsInWins: 0,
    wonSetsInLosses: 0,
    lostSetsInLosses: 0,
  });
});

test("singles set points stay combined when totals cannot be split safely", () => {
  assert.equal(splitSinglesSetPoints({
    singles_wins: 1,
    singles_losses: 1,
    singles_sets_won: 5,
    singles_sets_lost: 3,
    singles_set_points: 4,
  }), null, "inconsistent total must not display a guessed split");
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

test("the first bench slot has substitution priority", () => {
  const effectiveLineup = applyAutomaticBenchSubstitutions([
    squadResult({ id: "absent-starter", position: "starter" }),
    squadResult({ id: "starter-two", played: true, position: "starter" }),
    squadResult({ id: "starter-three", played: true, position: "starter" }),
    squadResult({ id: "starter-four", played: true, position: "starter" }),
    squadResult({ id: "bench-left", played: true, points: 2, position: "bench" }),
    squadResult({ id: "bench-right", played: true, points: 20, position: "bench" }),
  ]);

  const firstBenchPlayer = effectiveLineup.find(
    (player) => player.id === "bench-left",
  );
  const secondBenchPlayer = effectiveLineup.find(
    (player) => player.id === "bench-right",
  );

  assert.equal(firstBenchPlayer.automatic_substitution, "in");
  assert.equal(firstBenchPlayer.team_points_contribution, 2);
  assert.equal(secondBenchPlayer.automatic_substitution, null);
  assert.equal(secondBenchPlayer.team_points_contribution, 0);
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

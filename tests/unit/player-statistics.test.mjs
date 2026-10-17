import assert from "node:assert/strict";
import test from "node:test";
import { formatOwnership, hasPlayerAppearance, summarizePlayerWeeks, winRate } from "../../lib/player-statistics.ts";

test("ownership percentages distinguish unavailable from zero and fit narrow cards", () => {
  assert.equal(formatOwnership(null), "—");
  assert.equal(formatOwnership(0), "0%");
  assert.equal(formatOwnership(100), "100%");
  assert.equal(formatOwnership(66.7), "66.7%");
});

test("a recorded loss with zero points counts as played; missed weeks do not", () => {
  const missed = { singles_wins: 0, singles_losses: 0, doubles_wins: 0, doubles_losses: 0 };
  assert.equal(hasPlayerAppearance(missed), false);
  assert.equal(hasPlayerAppearance({ ...missed, singles_losses: 1 }), true);
  assert.equal(hasPlayerAppearance({ ...missed, doubles_losses: 1 }), true);
});

test("player win rate distinguishes unplayed from losses and rounds a percentage", () => {
  assert.equal(winRate(0, 0), null);
  assert.equal(winRate(0, 3), 0);
  assert.equal(winRate(2, 1), 67);
});

test("player totals include doubles-only weeks and skip missed appearances", () => {
  const empty = { fantasy_points: 0, singles_wins: 0, singles_losses: 0, doubles_wins: 0, doubles_losses: 0, singles_sets_won: 0, singles_sets_lost: 0, singles_set_points: 0, singles_won_match_sets_won: 0, singles_won_match_sets_lost: 0, singles_won_match_set_points: 0, singles_lost_match_sets_won: 0, singles_lost_match_sets_lost: 0, singles_lost_match_set_points: 0 };
  const totals = summarizePlayerWeeks([
    { ...empty, fantasy_points: 12, singles_wins: 1, singles_sets_won: 3, singles_sets_lost: 1, singles_set_points: 2, singles_won_match_sets_won: 3, singles_won_match_sets_lost: 1, singles_won_match_set_points: 2 },
    { ...empty, fantasy_points: 6, doubles_wins: 1 },
    empty,
    { ...empty, singles_losses: 1, singles_sets_lost: 3, singles_lost_match_sets_lost: 3 },
  ]);
  assert.equal(totals.points, 18);
  assert.equal(totals.appearances, 3);
  assert.equal(totals.singlesWins, 1);
  assert.equal(totals.doublesWins, 1);
  assert.equal(totals.setsLost, 4);
  assert.equal(totals.setPoints, 2);
  assert.equal(totals.wonMatchSetsWon, 3);
  assert.equal(totals.wonMatchSetsLost, 1);
  assert.equal(totals.wonMatchSetPoints, 2);
  assert.equal(totals.lostMatchSetsWon, 0);
  assert.equal(totals.lostMatchSetsLost, 3);
  assert.equal(totals.lostMatchSetPoints, 0);
  assert.equal(summarizePlayerWeeks([]).appearances, 0);
});

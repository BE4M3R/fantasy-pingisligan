import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameweeks,
  preserveLockedGameweekBoundaries,
  resolveFixtureGameweekId,
} from "../../scripts/import-stupa-schedule.mjs";

const incomingGameweek = {
  stupa_stage_id: 5727,
  stupa_round_id: 1,
  name: "Round 1",
  round_order: 1,
  first_match_starts_at: "2026-09-22T16:00:00.000Z",
  last_match_ends_at: "2026-09-22T19:30:00.000Z",
  lock_at: "2026-09-22T14:00:00.000Z",
  unlock_at: "2026-09-22T22:00:00.000Z",
};

test("gameweek deadline follows the earliest fixture and unlock follows the final fixture day", () => {
  const gameweeks = buildGameweeks([
    {
      id: 1,
      round_id: 10,
      round: { name: "Round 10", order: 10 },
      start_time: "2026-09-22T18:30:00",
      end_time: "2026-09-22T21:30:00",
    },
    {
      id: 2,
      round_id: 10,
      round: { name: "Round 10", order: 10 },
      start_time: "2026-09-22T18:00:00",
      end_time: "2026-09-22T21:00:00",
    },
  ], 5727);

  assert.equal(gameweeks.length, 1);
  assert.equal(gameweeks[0].first_match_starts_at, "2026-09-22T16:00:00.000Z");
  assert.equal(gameweeks[0].last_match_ends_at, "2026-09-22T19:30:00.000Z");
  assert.equal(gameweeks[0].lock_at, "2026-09-22T14:00:00.000Z");
  assert.equal(gameweeks[0].unlock_at, "2026-09-22T22:00:00.000Z");
});

test("schedule changes before the existing deadline replace lock and unlock times", () => {
  const existing = [{
    stupa_round_id: 1,
    lock_at: "2026-09-22T14:30:00.000Z",
    unlock_at: "2026-09-22T21:30:00.000Z",
  }];

  const [result] = preserveLockedGameweekBoundaries(
    [incomingGameweek],
    existing,
    "2026-09-22T12:00:00.000Z",
  );

  assert.equal(result.lock_at, incomingGameweek.lock_at);
  assert.equal(result.unlock_at, incomingGameweek.unlock_at);
});

test("schedule changes at or after the existing deadline preserve lock and unlock boundaries", () => {
  const existing = [{
    stupa_round_id: 1,
    lock_at: "2026-09-22T14:30:00.000Z",
    unlock_at: "2026-09-22T21:30:00.000Z",
  }];

  for (const refreshedAt of [
    "2026-09-22T14:30:00.000Z",
    "2026-09-23T08:00:00.000Z",
  ]) {
    const [result] = preserveLockedGameweekBoundaries(
      [incomingGameweek],
      existing,
      refreshedAt,
    );
    assert.equal(result.lock_at, existing[0].lock_at);
    assert.equal(result.unlock_at, existing[0].unlock_at);
    assert.equal(result.first_match_starts_at, incomingGameweek.first_match_starts_at);
    assert.equal(result.last_match_ends_at, incomingGameweek.last_match_ends_at);
  }
});

test("an existing fixture keeps its original gameweek when STUPA moves its round", () => {
  const existingMatches = new Map([
    [88977, { fantasy_gameweek_id: "original-gameweek" }],
    [88983, { fantasy_gameweek_id: null }],
  ]);
  const currentGameweeks = new Map([
    [2, { id: "new-round-gameweek" }],
  ]);

  assert.equal(
    resolveFixtureGameweekId(88977, 2, existingMatches, currentGameweeks),
    "original-gameweek",
  );
  assert.equal(
    resolveFixtureGameweekId(88983, 2, existingMatches, currentGameweeks),
    "new-round-gameweek",
  );
  assert.equal(
    resolveFixtureGameweekId(99999, 2, existingMatches, currentGameweeks),
    "new-round-gameweek",
  );
});

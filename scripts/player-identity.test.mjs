import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReconciliationPlan,
  validateSourceIdentities,
} from "./import-profixio-players.mjs";
import { buildImportRows } from "./import-stupa-results.mjs";

function sourcePlayer(overrides = {}) {
  return {
    birthYear: 2005,
    clubName: "Kosta SK",
    firstName: "Aleksi",
    lastName: "Räsänen",
    price: 7600000,
    profixioPlayerId: "976954",
    rankingPoints: 2276,
    rankingPosition: 98,
    ...overrides,
  };
}

function databasePlayer(overrides = {}) {
  return {
    birth_year: 2005,
    clubs: { name: "Kosta SK" },
    created_at: "2026-08-09T00:00:00Z",
    first_name: "Aleksi",
    id: "player-old",
    last_name: "Räsänen",
    profixio_id: "966863",
    ...overrides,
  };
}

test("current license wins and matching stale records are merged", () => {
  const oldPlayer = databasePlayer();
  const currentPlayer = databasePlayer({
    created_at: "2026-08-28T00:00:00Z",
    id: "player-current",
    profixio_id: "976954",
  });
  const plan = buildReconciliationPlan([sourcePlayer()], {
    identities: [
      {
        external_id: "966863",
        player_id: oldPlayer.id,
        provider: "sbtf_license",
      },
      {
        external_id: "976954",
        player_id: currentPlayer.id,
        provider: "sbtf_license",
      },
    ],
    players: [oldPlayer, currentPlayer],
  });

  assert.equal(plan[0].player.id, currentPlayer.id);
  assert.deepEqual(plan[0].duplicates.map((player) => player.id), [oldPlayer.id]);
  assert.equal(plan[0].matchKind, "license");
});

test("a changed license and club retain a unique name and birth-year identity", () => {
  const existingPlayer = databasePlayer({ clubs: { name: "Old Club" } });
  const plan = buildReconciliationPlan([sourcePlayer()], {
    identities: [
      {
        external_id: "966863",
        player_id: existingPlayer.id,
        provider: "sbtf_license",
      },
    ],
    players: [existingPlayer],
  });

  assert.equal(plan[0].player.id, existingPlayer.id);
  assert.equal(plan[0].matchKind, "name-and-birth-year");
  assert.deepEqual(plan[0].duplicates, []);
});

test("a source identity not found in the database creates a player", () => {
  const plan = buildReconciliationPlan([sourcePlayer()], {
    identities: [],
    players: [],
  });

  assert.equal(plan[0].player, null);
  assert.equal(plan[0].matchKind, "new");
});

test("duplicate source identities stop the import", () => {
  assert.throws(
    () =>
      validateSourceIdentities([
        sourcePlayer(),
        sourcePlayer({ profixioPlayerId: "another-license" }),
      ]),
    /multiple licenses/,
  );
});

function stupaParent(detail) {
  return {
    id: 100,
    participants: [
      { order: 1, participant_id: 10 },
      { order: 2, participant_id: 20 },
    ],
    status: "SCORED",
    sub_matches: [
      {
        id: 101,
        is_golden_match: false,
        order: 1,
        participants: [
          {
            order: 1,
            participant_details: [detail],
            participant_id: 10,
            points: [11, 11, 11],
            points_lost: 10,
            points_won: 33,
            sets: [1, 1, 1],
            sets_lost: 0,
            sets_won: 3,
            walkover: false,
          },
        ],
        status: "SCORED",
        winner: 10,
      },
    ],
    winner: 10,
  };
}

function stupaDetail(overrides = {}) {
  return {
    meta_data: { license_id: "976954" },
    name: "Aleksi Räsänen",
    participant_label: "A1",
    user_role_id: 1234,
    ...overrides,
  };
}

function stupaRows(detail, licensePlayer, rolePlayer) {
  return buildImportRows(
    [stupaParent(detail)],
    new Map([[100, { fantasy_gameweek_id: "gameweek", id: "match" }]]),
    licensePlayer ? new Map([["976954", licensePlayer]]) : new Map(),
    rolePlayer ? new Map([["1234", rolePlayer]]) : new Map(),
  );
}

test("Stupa resolves a player through a historical license alias", () => {
  const rows = stupaRows(stupaDetail(), { id: "player" }, null);

  assert.equal(rows.playerResults[0].player_id, "player");
  assert.deepEqual(rows.identityConflicts, []);
});

test("Stupa falls back to a known role identity", () => {
  const rows = stupaRows(stupaDetail(), null, { id: "player" });

  assert.equal(rows.playerResults[0].player_id, "player");
});

test("Stupa refuses conflicting license and role identities", () => {
  const rows = stupaRows(
    stupaDetail(),
    { id: "license-player" },
    { id: "role-player" },
  );

  assert.equal(rows.playerResults[0].player_id, null);
  assert.equal(rows.identityConflicts.length, 1);
});

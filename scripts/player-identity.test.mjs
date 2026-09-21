import assert from "node:assert/strict";
import test from "node:test";
import { buildImportRows, buildManualPlayerLookup, reportUnmatchedPlayers } from "./import-stupa-results.mjs";
import roster from "../data/sbtf-rosters.json" with { type: "json" };

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

test("an unknown doubles partner is retained without blocking the known player's result", () => {
  const parent = stupaParent(stupaDetail());
  parent.participants[0].participant_name = "Club outside the catalogue";
  parent.sub_matches[0].participants[0].participant_details.push(stupaDetail({
    name: "Unknown Player", user_role_id: 5678, meta_data: { license_id: "unknown-license" },
  }));
  const rows = buildImportRows([parent],
    new Map([[100, { id: "match", fantasy_gameweek_id: "gameweek" }]]),
    new Map([["976954", { id: "known-player" }]]), new Map());

  assert.deepEqual(rows.playerResults.map((row) => row.player_id), ["known-player", null]);
  assert.equal(rows.playerResults[1].stupa_user_role_id, 5678);
  assert.equal(rows.playerResults[1].sets_won, 3);
  assert.equal(rows.playerResults[0].team_stupa_participant_id, rows.playerResults[1].team_stupa_participant_id);
  assert.deepEqual(rows.gameweekIds, ["gameweek"]);
  assert.deepEqual(rows.identityConflicts, []);
  assert.deepEqual(rows.unmatchedPlayers, [{
    name: "Unknown Player", licenseId: "unknown-license", stupaUserRoleId: 5678,
    clubs: ["Club outside the catalogue"], fixtureIds: [100],
  }]);

  // A later reviewed mapping links the same raw result key, without inventing
  // an identity or requiring a new player import from an external source.
  const linked = buildImportRows([parent], new Map([[100, { id: "match" }]]),
    new Map([["976954", { id: "known-player" }]]), new Map([["5678", { id: "reviewed-player" }]]));
  assert.equal(linked.playerResults[1].player_id, "reviewed-player");
  assert.equal(linked.playerResults[1].stupa_submatch_id, rows.playerResults[1].stupa_submatch_id);
  assert.deepEqual(linked.unmatchedPlayers, []);
});

test("unknown players produce one warning each with every affected club and fixture", () => {
  const first = stupaParent(stupaDetail());
  first.participants[0].participant_name = "First club";
  const second = structuredClone(first);
  second.id = 200;
  second.sub_matches[0].id = 201;
  second.participants[0].participant_name = "Second club";
  const rows = buildImportRows([first, second], new Map(), new Map(), new Map(), true);
  const warnings = [];
  reportUnmatchedPlayers(rows.unmatchedPlayers, { warn: (message) => warnings.push(message), githubActions: false });
  assert.equal(warnings.length, 1);
  for (const detail of ["Aleksi Räsänen", "First club, Second club", "976954", "1234", "100, 200", "Skipped for fantasy scoring"]) {
    assert.ok(warnings[0].includes(detail), detail);
  }
});

test("GitHub warnings safely render upstream text and matched-only imports stay quiet", () => {
  const warnings = [];
  const options = { warn: (message) => warnings.push(message), githubActions: true };
  reportUnmatchedPlayers([], options);
  assert.deepEqual(warnings, []);
  reportUnmatchedPlayers([{
    name: "Unknown%Player\n::error::source text", licenseId: null, stupaUserRoleId: 5678,
    clubs: ["Some\r\nclub"], fixtureIds: [100],
  }], options);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].startsWith("::warning title=Unmatched STUPA player::"));
  assert.ok(warnings[0].includes("Unknown%25Player"));
  assert.ok(warnings[0].includes("license: missing"));
  assert.doesNotMatch(warnings[0], /[\r\n]/);
});

const manualPlayers = roster.clubs.flatMap((club) => club.players
  .filter((entry) => entry.playerId)
  .map((entry) => ({
    id: entry.playerId,
    first_name: entry.firstName,
    last_name: entry.lastName,
    clubs: { name: club.club },
    active: true,
    profixio_id: null,
  })));

function manualRows(name, options = {}) {
  const parent = stupaParent(stupaDetail({
    name,
    meta_data: { license_id: options.licenseId ?? null },
  }));
  parent.participants[0].participant_name = options.club ?? "Eskilstuna by STIGA";
  return buildImportRows([parent], new Map([[100, { id: "match" }]]),
    options.licenses ?? new Map(), options.roles ?? new Map(), false,
    buildManualPlayerLookup(options.players ?? manualPlayers));
}

test("both unranked players resolve to their existing squad UUID without a license", () => {
  for (const player of manualPlayers) {
    const rows = manualRows(`${player.first_name} ${player.last_name}`);
    assert.equal(rows.playerResults[0].player_id, player.id);
    assert.equal(rows.playerResults[0].stupa_license_id, null);
    assert.deepEqual(rows.unmatchedPlayers, []);
    assert.deepEqual(rows.identityConflicts, []);
  }
});

test("approved name-order and club aliases resolve a new real license", () => {
  const rows = manualRows("  ASUKA   MACHI ", {
    club: "Lindén BTK Esklistuna*", licenseId: "new-real-license",
  });
  assert.equal(rows.playerResults[0].player_id, manualPlayers[1].id);
  assert.equal(rows.playerResults[0].stupa_license_id, "new-real-license");
});

test("a learned manual player's role remains valid after a name change or transfer", () => {
  const rows = manualRows("Changed source spelling", {
    club: "Kosta SK", roles: new Map([["1234", manualPlayers[0]]]),
  });
  assert.equal(rows.playerResults[0].player_id, manualPlayers[0].id);
  assert.deepEqual(rows.identityConflicts, []);
});

test("manual fallback requires a parent team linked by participant ID", () => {
  const parent = stupaParent(stupaDetail({ name: "Fumiya Igarashi", meta_data: {} }));
  parent.participants[0].participant_name = "Eskilstuna by STIGA";
  delete parent.participants[0].participant_id;
  delete parent.sub_matches[0].participants[0].participant_id;
  const rows = buildImportRows([parent], new Map(), new Map(), new Map(), true,
    buildManualPlayerLookup(manualPlayers));
  assert.equal(rows.playerResults[0].player_id, null);
});

test("manual matching requires the correct club, an approved exact name, and an active anchor", () => {
  for (const options of [
    { club: "Eskilstuna BTK" }, { club: "Kosta SK" },
    { players: [] }, { players: manualPlayers.map((p) => ({ ...p, active: false })) },
    { players: manualPlayers.map((p) => ({ ...p, clubs: { name: "Kosta SK" } })) },
  ]) {
    assert.equal(manualRows("Fumiya Igarashi", options).playerResults[0].player_id, null);
  }
  assert.equal(manualRows("F. Igarashi").playerResults[0].player_id, null);
});

test("a namesake or conflicting license/role blocks manual identity assignment", () => {
  for (const options of [
    { players: [...manualPlayers, { ...manualPlayers[0], id: "namesake" }] },
    { licenseId: "known", licenses: new Map([["known", { id: "someone-else" }]]) },
    { roles: new Map([["1234", { id: "someone-else" }]]) },
  ]) {
    const rows = manualRows("Fumiya Igarashi", options);
    assert.equal(rows.playerResults[0].player_id, null);
    assert.equal(rows.identityConflicts.length, 1);
  }
});

test("reused new Stupa identities cannot claim two players in the same import", () => {
  for (const sharedLicense of [false, true]) {
    const parents = manualPlayers.map((player, index) => {
      const parent = stupaParent(stupaDetail({
        name: `${player.first_name} ${player.last_name}`,
        user_role_id: sharedLicense ? 1234 + index : 1234,
        meta_data: { license_id: sharedLicense ? "shared-new-license" : null },
      }));
      parent.id += index;
      parent.sub_matches[0].id += index;
      parent.participants[0].participant_name = "Eskilstuna by STIGA";
      return parent;
    });
    const rows = buildImportRows(parents, new Map(), new Map(), new Map(), true,
      buildManualPlayerLookup(manualPlayers));
    assert.equal(rows.identityConflicts.length, 1);
  }
});

test("doubles results retain each unranked player's separate squad identity", () => {
  const parent = stupaParent(stupaDetail());
  parent.participants[0].participant_name = "Eskilstuna by STIGA";
  parent.sub_matches[0].participants[0].participant_details = manualPlayers.map((p, i) =>
    stupaDetail({ name: `${p.first_name} ${p.last_name}`, user_role_id: 1234 + i, meta_data: {} }));
  const rows = buildImportRows([parent], new Map(), new Map(), new Map(), true,
    buildManualPlayerLookup(manualPlayers));
  assert.deepEqual(rows.playerResults.map((r) => r.player_id), manualPlayers.map((p) => p.id));
  assert.deepEqual(rows.identityConflicts, []);
});

test("all 51 licensed SBTF roster players match Stupa licenses regardless of names or transfers", () => {
  for (const entry of roster.clubs.flatMap((club) => club.players).filter((p) => p.licenseId)) {
    const player = { id: `uuid-for-${entry.licenseId}` };
    const parent = stupaParent(stupaDetail({ name: "Different source spelling", meta_data: { license_id: entry.licenseId } }));
    const rows = buildImportRows([parent], new Map(), new Map([[entry.licenseId, player]]), new Map(), true);
    assert.equal(rows.playerResults[0].player_id, player.id);
  }
});

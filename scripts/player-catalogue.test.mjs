import assert from "node:assert/strict";
import test from "node:test";
import catalogue from "../data/player-catalogue.json" with { type: "json" };
import roster from "../data/sbtf-rosters.json" with { type: "json" };
import { buildCataloguePlan, buildExplicitPriceUpdates, importCatalogue, importLocalCatalogue, validateCatalogue } from "./import-fantasy-players.mjs";

function database(initial = {}) {
  const state = { clubs: [], players: [], player_external_identities: [], ...structuredClone(initial) };
  const writes = [];
  const client = { from(table) {
    assert.ok(table in state, `Unexpected table access: ${table}`);
    return {
      select() { return this; }, order() { return this; },
      async range(from, to) { return { data: structuredClone(state[table].slice(from, to + 1)), error: null }; },
      async upsert(rows, { onConflict, ignoreDuplicates }) {
        assert.equal(ignoreDuplicates, true);
        for (const row of rows) {
          if (!state[table].some((old) => onConflict.split(",").every((key) => old[key] === row[key]))) {
            state[table].push(structuredClone(row));
          }
        }
        writes.push({ table, rows });
        return { error: null };
      },
      update(changes) { return { async eq(key, value) {
        const row = state[table].find((row) => row[key] === value);
        Object.assign(row, changes);
        writes.push({ table, changes });
        return { error: null };
      } }; },
    };
  } };
  return { state, writes, client };
}

const empty = { clubs: [], players: [], identities: [] };

test("catalogue retains every roster UUID/license and explicitly priced active player", () => {
  validateCatalogue(catalogue);
  assert.equal(catalogue.source, "committed-catalogue");
  assert.equal("exportedAt" in catalogue, false);
  assert.match(catalogue.syncedFromProductionAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(catalogue.clubs.length, 10);
  assert.equal(catalogue.players.length, 75);
  assert.equal(catalogue.playerExternalIdentities.length, 74);
  const active = catalogue.players.filter((player) => player.active);
  assert.equal(active.length, 53);
  assert.equal(catalogue.players.length - active.length, 22);
  for (const entry of roster.clubs.flatMap((club) => club.players)) {
    const matches = active.filter((player) => entry.playerId ? player.id === entry.playerId : player.profixio_id === entry.licenseId);
    assert.equal(matches.length, 1, entry.name);
    if (entry.playerId) assert.equal(matches[0].price, 10000000);
  }
});

test("setup and repeat imports make no upstream request, preserve snapshot prices and are idempotent", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  await importLocalCatalogue({ dryRun: true });
  const db = database();
  await importCatalogue(db.client, catalogue);
  assert.deepEqual(db.state.players, catalogue.players);
  const first = structuredClone(db.state);
  const writes = db.writes.length;
  await importCatalogue(db.client, catalogue);
  assert.deepEqual(db.state, first);
  assert.equal(db.writes.length, writes);
});

test("replaying the catalogue preserves prices, ownership, historical rows and learned identities", async () => {
  const original = catalogue.players.find((p) => p.active);
  const learned = { ...original, price: original.price + 12345, profixio_id: "renewed-license", stupa_user_role_id: 987654 };
  const historical = { ...catalogue.players[0], id: "12345678-1234-1234-1234-123456789abc", active: false, first_name: "Historical", last_name: "Player", profixio_id: "historical" };
  const ownership = [{ player_id: original.id, fantasy_team_id: "team" }];
  const db = database({
    clubs: catalogue.clubs, players: [learned, historical],
    player_external_identities: [{ provider: "sbtf_license", external_id: "renewed-license", player_id: original.id, is_current: true }],
    fantasy_team_players: ownership, fantasy_teams: [{ id: "team", budget: 100000000 }],
  });
  await importCatalogue(db.client, catalogue);
  assert.deepEqual(db.state.players.find((p) => p.id === original.id), learned);
  assert.deepEqual(db.state.players.find((p) => p.id === historical.id), historical);
  assert.deepEqual(db.state.fantasy_team_players, ownership);
  assert.deepEqual(db.state.fantasy_teams, [{ id: "team", budget: 100000000 }]);
  assert.equal(db.state.player_external_identities[0].is_current, true);
  assert.ok(db.state.player_external_identities.some((row) => row.external_id === original.profixio_id));
  const after = structuredClone(db.state);
  await importCatalogue(db.client, catalogue);
  assert.deepEqual(db.state, after);
});

test("explicit deactivation preserves price, UUID and ownership", async () => {
  const updated = structuredClone(catalogue);
  const active = updated.players.find((p) => p.active);
  active.active = false;
  active.price += 100;
  const original = catalogue.players.find((p) => p.id === active.id);
  const db = database({ clubs: catalogue.clubs, players: catalogue.players });
  await importCatalogue(db.client, updated);
  assert.deepEqual(db.state.players.find((p) => p.id === active.id), { ...original, active: false });
  assert.ok(db.writes.every((write) => !write.changes || !("price" in write.changes)));
});

test("identity conflicts and invalid catalogue prices fail before any writes", async () => {
  const db = database({ players: [{ ...catalogue.players[0], id: "different-id" }] });
  await assert.rejects(importCatalogue(db.client, catalogue), /different UUID/);
  assert.equal(db.writes.length, 0);
  for (const price of [null, 0, -5, "not-a-price"]) {
    const invalid = structuredClone(catalogue);
    invalid.players[0].price = price;
    assert.throws(() => buildCataloguePlan(invalid, empty), /explicit price/);
  }
  assert.throws(
    () => validateCatalogue({ ...catalogue, source: "staging" }),
    /reviewed committed catalogue/,
  );
});

test("future explicit prices use UUIDs and no ranking formula or roster writes", () => {
  const player = catalogue.players[0];
  const updates = buildExplicitPriceUpdates([{ id: player.id, price: 12345678 }], [player]);
  assert.deepEqual(updates, [{ id: player.id, price: 12345678 }]);
  assert.deepEqual(buildExplicitPriceUpdates(updates, [{ ...player, price: 12345678 }]), []);
  assert.throws(() => buildExplicitPriceUpdates([{ id: "unknown", price: 1 }], [player]), /Invalid/);
  assert.throws(() => buildExplicitPriceUpdates([...updates, ...updates], [player]), /duplicate/);
});

test("all existing active and inactive players outside the snapshot survive imports with ownership and history", async () => {
  // Exceed one read page to also prove historical players are not lost to a
  // default database row limit. These represent rows unknown to the snapshot.
  const existing = Array.from({ length: 1100 }, (_, index) => ({
    ...catalogue.players[0],
    id: `existing-player-${index}`, first_name: "Existing", last_name: `Player ${index}`,
    profixio_id: `existing-license-${index}`, active: index % 2 === 0,
    price: 7654321 + index,
  }));
  const ownership = existing.map((player) => ({ player_id: player.id, fantasy_team_id: "team" }));
  const snapshots = ownership.map((row) => ({ ...row, fantasy_gameweek_id: "past-gw" }));
  const db = database({ clubs: catalogue.clubs, players: existing,
    fantasy_team_players: ownership, fantasy_team_gameweek_players: snapshots });
  await importCatalogue(db.client, catalogue);
  await importCatalogue(db.client, catalogue);
  assert.equal(db.state.players.length, existing.length + catalogue.players.length);
  assert.deepEqual(db.state.players.slice(0, existing.length), existing);
  assert.deepEqual(db.state.fantasy_team_players, ownership);
  assert.deepEqual(db.state.fantasy_team_gameweek_players, snapshots);
});

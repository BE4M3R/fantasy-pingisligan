import assert from "node:assert/strict";
import test from "node:test";
import catalogue from "../../data/player-catalogue.json" with { type: "json" };
import { buildPlayerDataMigration, parsePlayerMigrationArguments } from "../../scripts/generate-player-migration.mjs";

test("player migration contains only explicitly selected catalogue players and safe inserts", () => {
  const player = catalogue.players.find((row) => row.profixio_id && row.club_id);
  const other = catalogue.players.find((row) => row.id !== player.id);
  const club = catalogue.clubs.find((row) => row.id === player.club_id);
  const sql = buildPlayerDataMigration(catalogue, [player.id]);

  assert.match(sql, new RegExp(`catalogue-player-id: ${player.id}`));
  assert.match(sql, new RegExp(player.first_name));
  assert.match(sql, new RegExp(club.name));
  assert.match(sql, new RegExp(String(player.profixio_id)));
  assert.doesNotMatch(sql, new RegExp(other.id));
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /on conflict \(provider, external_id\) do nothing/);
  assert.match(sql, /end;\n\$catalogue_preflight\$;/);
  assert.doesNotMatch(sql, /\b(?:update|delete|merge)\b/i);
});

test("player migration requires explicit, unique catalogue UUIDs", () => {
  const playerId = catalogue.players[0].id;
  assert.deepEqual(parsePlayerMigrationArguments(["--player-id", playerId]), [playerId]);
  assert.throws(() => parsePlayerMigrationArguments([]), /At least one/);
  assert.throws(() => parsePlayerMigrationArguments(["--player-id"]), /Missing value/);
  assert.throws(() => parsePlayerMigrationArguments(["--all"]), /Unknown argument/);
  assert.throws(() => parsePlayerMigrationArguments([
    "--player-id", playerId, "--player-id", playerId,
  ]), /Duplicate/);
  assert.throws(() => buildPlayerDataMigration(catalogue, [
    "00000000-0000-0000-0000-000000000000",
  ]), /Unknown catalogue player/);
});

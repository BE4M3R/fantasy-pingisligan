import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalogue } from "./import-fantasy-players.mjs";

const catalogueUrl = new URL("../data/player-catalogue.json", import.meta.url);
const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);

function sqlText(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlInteger(value, label, { optional = true } = {}) {
  if (optional && (value === null || value === undefined)) return "null";
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} must be a whole number.`);
  return String(number);
}

const raiseConflict = (message) => `    raise exception using message = ${sqlText(message)};\n`;

function currentIdentities(players) {
  return players.flatMap((player) => [
    ["sbtf_license", player.profixio_id],
    ["stupa_user_role", player.stupa_user_role_id],
  ].filter(([, externalId]) => externalId !== null && externalId !== undefined)
    .map(([provider, externalId]) => ({
      provider,
      external_id: String(externalId),
      player_id: player.id,
    })));
}

export function parsePlayerMigrationArguments(args) {
  const playerIds = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--player-id") throw new Error(`Unknown argument: ${args[index]}`);
    const playerId = args[index + 1];
    if (!playerId || playerId.startsWith("--")) throw new Error("Missing value for --player-id.");
    playerIds.push(playerId);
    index += 1;
  }
  if (!playerIds.length) throw new Error("At least one --player-id is required.");
  if (new Set(playerIds).size !== playerIds.length) throw new Error("Duplicate --player-id.");
  return playerIds;
}

export function buildPlayerDataMigration(catalogue, playerIds) {
  validateCatalogue(catalogue);
  if (!Array.isArray(playerIds) || !playerIds.length) {
    throw new Error("At least one player UUID is required.");
  }
  if (new Set(playerIds).size !== playerIds.length) throw new Error("Duplicate player UUID.");

  const playersById = new Map(catalogue.players.map((player) => [player.id, player]));
  const players = playerIds.map((playerId) => {
    const player = playersById.get(playerId);
    if (!player) throw new Error(`Unknown catalogue player UUID: ${playerId}.`);
    return player;
  });
  const clubIds = new Set(players.map((player) => player.club_id).filter(Boolean));
  const clubs = catalogue.clubs.filter((club) => clubIds.has(club.id));
  if (clubs.length !== clubIds.size) throw new Error("A selected player references an unknown club.");

  const selectedIds = new Set(playerIds);
  const identitiesByKey = new Map();
  for (const identity of [
    ...catalogue.playerExternalIdentities.filter((row) => selectedIds.has(row.player_id)),
    ...currentIdentities(players),
  ]) {
    const key = `${identity.provider}:${identity.external_id}`;
    const existing = identitiesByKey.get(key);
    if (existing && existing.player_id !== identity.player_id) {
      throw new Error(`Conflicting catalogue identity ${key}.`);
    }
    identitiesByKey.set(key, identity);
  }
  const identities = [...identitiesByKey.values()];

  const preflight = [];
  for (const club of clubs) {
    preflight.push(
      `  if exists (select 1 from public.clubs where id = ${sqlText(club.id)}::uuid and name is distinct from ${sqlText(club.name)}) then\n` +
      raiseConflict(`Catalogue club UUID ${club.id} belongs to a different name`) +
      "  end if;",
      `  if exists (select 1 from public.clubs where name = ${sqlText(club.name)} and id <> ${sqlText(club.id)}::uuid) then\n` +
      raiseConflict(`Catalogue club name ${club.name} belongs to a different UUID`) +
      "  end if;",
    );
  }
  for (const player of players) {
    preflight.push(
      `  if exists (select 1 from public.players where id = ${sqlText(player.id)}::uuid and ` +
      `(first_name is distinct from ${sqlText(player.first_name)} or last_name is distinct from ${sqlText(player.last_name)})) then\n` +
      raiseConflict(`Catalogue player UUID ${player.id} belongs to a different name`) +
      "  end if;",
    );
    if (player.profixio_id !== null && player.profixio_id !== undefined) {
      preflight.push(
        `  if exists (select 1 from public.players where profixio_id = ${sqlText(player.profixio_id)} and id <> ${sqlText(player.id)}::uuid) then\n` +
        raiseConflict(`SBTF license ${player.profixio_id} belongs to a different player UUID`) +
        "  end if;",
      );
    }
    if (player.stupa_user_role_id !== null && player.stupa_user_role_id !== undefined) {
      const roleId = sqlInteger(player.stupa_user_role_id, "STUPA role ID", { optional: false });
      preflight.push(
        `  if exists (select 1 from public.players where stupa_user_role_id = ${roleId} and id <> ${sqlText(player.id)}::uuid) then\n` +
        raiseConflict(`STUPA role ${roleId} belongs to a different player UUID`) +
        "  end if;",
      );
    }
  }
  for (const identity of identities) {
    preflight.push(
      `  if exists (select 1 from public.player_external_identities where provider = ${sqlText(identity.provider)} ` +
      `and external_id = ${sqlText(identity.external_id)} and player_id <> ${sqlText(identity.player_id)}::uuid) then\n` +
      raiseConflict(`External identity ${identity.provider}:${identity.external_id} belongs to a different player UUID`) +
      "  end if;",
    );
  }

  const clubValues = clubs.map((club) =>
    `  (${sqlText(club.id)}::uuid, ${sqlText(club.name)}, ${sqlText(club.short_name)})`,
  ).join(",\n");
  const playerValues = players.map((player) =>
    "  (" + [
      `${sqlText(player.id)}::uuid`, sqlText(player.profixio_id),
      sqlInteger(player.stupa_user_role_id, "STUPA role ID"),
      player.club_id ? `${sqlText(player.club_id)}::uuid` : "null",
      sqlText(player.first_name), sqlText(player.last_name),
      sqlInteger(player.birth_year, "Birth year"),
      sqlInteger(player.ranking_position, "Ranking position"),
      sqlInteger(player.ranking_points, "Ranking points"),
      sqlInteger(player.price, "Player price", { optional: false }),
      player.active ? "true" : "false",
    ].join(", ") + ")",
  ).join(",\n");
  const identityValues = identities.map((identity) =>
    `  (${sqlText(identity.provider)}, ${sqlText(identity.external_id)}, ${sqlText(identity.player_id)}::uuid, false)`,
  ).join(",\n");

  return [
    "-- Generated from data/player-catalogue.json by npm run generate:player-migration.",
    "-- Existing players, prices, ownership and history are intentionally preserved.",
    ...playerIds.map((playerId) => `-- catalogue-player-id: ${playerId}`),
    "",
    "do $catalogue_preflight$",
    "begin",
    ...preflight,
    "end;",
    "$catalogue_preflight$;",
    ...(clubValues ? [
      "",
      "insert into public.clubs (id, name, short_name)",
      "values",
      clubValues,
      "on conflict (id) do nothing;",
    ] : []),
    "",
    "insert into public.players (",
    "  id, profixio_id, stupa_user_role_id, club_id, first_name, last_name,",
    "  birth_year, ranking_position, ranking_points, price, active",
    ")",
    "values",
    playerValues,
    "on conflict (id) do nothing;",
    ...(identityValues ? [
      "",
      "insert into public.player_external_identities (provider, external_id, player_id, is_current)",
      "values",
      identityValues,
      "on conflict (provider, external_id) do nothing;",
    ] : []),
    "",
  ].join("\n");
}

function migrationTimestamp(date = new Date()) {
  return date.toISOString().replace(/\D/g, "").slice(0, 14);
}

async function ensurePlayersHaveNoMigration(playerIds) {
  const files = (await readdir(migrationsUrl)).filter((file) => file.endsWith(".sql"));
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsUrl), "utf8");
    for (const playerId of playerIds) {
      if (sql.includes(`-- catalogue-player-id: ${playerId}`)) {
        throw new Error(`Player ${playerId} is already included in migration ${file}.`);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: npm run generate:player-migration -- --player-id <uuid> [--player-id <uuid> ...]");
    return;
  }
  const playerIds = parsePlayerMigrationArguments(args);
  await ensurePlayersHaveNoMigration(playerIds);
  const catalogue = JSON.parse(await readFile(catalogueUrl, "utf8"));
  const sql = buildPlayerDataMigration(catalogue, playerIds);
  const filename = `${migrationTimestamp()}_add_catalogue_players.sql`;
  const outputPath = fileURLToPath(new URL(filename, migrationsUrl));
  await writeFile(outputPath, sql, { encoding: "utf8", flag: "wx" });
  console.log(`Created ${path.relative(process.cwd(), outputPath)} for ${playerIds.length} player(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

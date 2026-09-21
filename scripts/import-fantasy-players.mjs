import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { hasConfiguredPrice } from "../lib/player-availability.ts";
import { loadEnvironment } from "./player-catalogue.mjs";

const cataloguePath = new URL("../data/player-catalogue.json", import.meta.url);
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const identityKey = (row) => `${row.provider}:${row.external_id}`;

export function validateCatalogue(catalogue) {
  if (catalogue.version !== 1) throw new Error("Unsupported player catalogue version.");
  if (catalogue.source !== "committed-catalogue") {
    throw new Error("Player imports require the reviewed committed catalogue.");
  }
  for (const key of ["clubs", "players", "playerExternalIdentities"]) {
    if (!Array.isArray(catalogue[key])) throw new Error(`Catalogue ${key} must be an array.`);
  }
  for (const key of ["clubs", "players"]) {
    const rows = catalogue[key];
    if (!rows.length || new Set(rows.map((row) => row.id)).size !== rows.length ||
        rows.some((row) => !uuid.test(row.id))) {
      throw new Error(`Catalogue ${key} needs nonempty, unique permanent UUIDs.`);
    }
  }
  const clubs = new Set(catalogue.clubs.map((club) => club.id));
  for (const player of catalogue.players) {
    if (!player.first_name?.trim() || !player.last_name?.trim() ||
        typeof player.active !== "boolean" || !hasConfiguredPrice(player.price) ||
        (player.club_id !== null && !clubs.has(player.club_id)) ||
        (player.active && !clubs.has(player.club_id))) {
      throw new Error(`Invalid name, club, status or explicit price for player ${player.id}.`);
    }
  }
  // Validate both historical aliases and current compatibility columns together.
  const owners = new Map();
  const players = new Set(catalogue.players.map((player) => player.id));
  for (const identity of catalogueIdentities(catalogue)) {
    if (!players.has(identity.player_id) || !identity.external_id ||
        !["sbtf_license", "stupa_user_role"].includes(identity.provider)) {
      throw new Error("Invalid player identity.");
    }
    const key = identityKey(identity);
    if (owners.has(key) && owners.get(key) !== identity.player_id) {
      throw new Error(`Conflicting identity ${key}.`);
    }
    owners.set(key, identity.player_id);
  }
}

function currentIdentities(players) {
  return players.flatMap((player) => [
    ["sbtf_license", player.profixio_id], ["stupa_user_role", player.stupa_user_role_id],
  ].filter(([, id]) => id != null).map(([provider, id]) => ({
    provider, external_id: String(id), player_id: player.id,
  })));
}

function catalogueIdentities(catalogue) {
  return [...catalogue.playerExternalIdentities, ...currentIdentities(catalogue.players)];
}

export function buildCataloguePlan(catalogue, existing) {
  validateCatalogue(catalogue);
  const players = new Map(existing.players.map((player) => [player.id, player]));
  const clubs = new Map(existing.clubs.map((club) => [club.id, club]));
  for (const club of catalogue.clubs) {
    if (existing.clubs.some((row) => row.name === club.name && row.id !== club.id)) {
      throw new Error(`Club ${club.name} has a different UUID; reconcile before importing.`);
    }
  }
  const owners = new Map();
  for (const identity of [...existing.identities, ...currentIdentities(existing.players), ...catalogueIdentities(catalogue)]) {
    const key = identityKey(identity);
    if (owners.has(key) && owners.get(key) !== identity.player_id) {
      throw new Error(`Identity ${key} has a different UUID; reconcile before importing.`);
    }
    owners.set(key, identity.player_id);
  }
  // An unknown UUID with the same name may be a mistaken replacement. Never
  // silently merge people or transfer ownership based on a name.
  const name = (p) => `${p.first_name} ${p.last_name}`.normalize("NFKC").trim().toLocaleLowerCase("sv-SE");
  for (const player of catalogue.players) {
    if (!players.has(player.id) && existing.players.some((row) => name(row) === name(player))) {
      throw new Error(`Player ${player.first_name} ${player.last_name} has a different UUID; review identity.`);
    }
  }
  const updates = [];
  for (const player of catalogue.players) {
    const current = players.get(player.id);
    if (!current) continue;
    const changes = {};
    for (const key of ["first_name", "last_name", "birth_year", "club_id", "active"]) {
      if (player[key] !== current[key]) changes[key] = player[key];
    }
    if (Object.keys(changes).length) updates.push({ id: player.id, changes });
  }
  const knownIdentities = new Set(existing.identities.map(identityKey));
  const identities = [...new Map(catalogueIdentities(catalogue).map((row) => [identityKey(row), row])).values()]
    .filter((row) => !knownIdentities.has(identityKey(row)))
    .map(({ provider, external_id, player_id }) => ({
      provider, external_id, player_id,
      // Do not replace a current identity learned by the results importer.
      is_current: false,
    }));
  return {
    clubs: catalogue.clubs.filter((club) => !clubs.has(club.id)),
    players: catalogue.players.filter((player) => !players.has(player.id)),
    updates,
    identities,
  };
}

// Future price providers supply only explicit { id, price } values here.
// Routine catalogue imports never call this boundary. A future runner must
// apply these updates in the pending unlocked window, before completing it,
// so the existing database trigger preserves owners' cash.
export function buildExplicitPriceUpdates(values, players) {
  const existing = new Map(players.map((player) => [player.id, player]));
  const seen = new Set();
  return values.flatMap(({ id, price }) => {
    if (!existing.has(id) || seen.has(id) || !hasConfiguredPrice(price)) {
      throw new Error(`Invalid or duplicate explicit player price: ${id}.`);
    }
    seen.add(id);
    return Number(existing.get(id).price) === Number(price) ? [] : [{ id, price: Number(price) }];
  });
}

async function fetchAll(supabase, table) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    let query = supabase.from(table).select("*");
    query = table === "player_external_identities"
      ? query.order("provider").order("external_id") : query.order("id");
    const { data, error } = await query.range(from, from + 499);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

export async function importCatalogue(supabase, catalogue) {
  validateCatalogue(catalogue);
  const [clubs, players, identities] = await Promise.all([
    fetchAll(supabase, "clubs"), fetchAll(supabase, "players"),
    fetchAll(supabase, "player_external_identities"),
  ]);
  const plan = buildCataloguePlan(catalogue, { clubs, players, identities });
  // Validate the complete plan before any writes. These operations are
  // retryable: no deletes, merges, ownership writes or existing price writes.
  for (const [table, rows, onConflict] of [
    ["clubs", plan.clubs, "id"], ["players", plan.players, "id"],
    ["player_external_identities", plan.identities, "provider,external_id"],
  ]) {
    if (!rows.length) continue;
    const { error } = await supabase.from(table).upsert(rows, { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`Could not import ${table}: ${error.message}`);
  }
  for (const { id, changes } of plan.updates) {
    const { error } = await supabase.from("players").update(changes).eq("id", id);
    if (error) throw new Error(`Could not update player ${id}: ${error.message}`);
  }
  return plan;
}

export async function importLocalCatalogue({ dryRun = false } = {}) {
  const catalogue = JSON.parse(await readFile(cataloguePath, "utf8"));
  validateCatalogue(catalogue);
  if (dryRun) {
    console.log(`Validated ${catalogue.players.length} players and ${catalogue.clubs.length} clubs offline; existing prices will be preserved.`);
    return;
  }
  const environment = await loadEnvironment("local");
  const supabase = createClient(environment.supabaseUrl, environment.apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const plan = await importCatalogue(supabase, catalogue);
  console.log(`Imported local catalogue: ${plan.players.length} new players, ${plan.updates.length} roster updates; existing prices preserved.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importLocalCatalogue({ dryRun: process.argv.includes("--dry-run") }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

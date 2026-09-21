import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const stagingCandidatePath = path.join(projectRoot, "data", "player-catalogue.staging.json");
const productionCandidatePath = path.join(projectRoot, "data", "player-catalogue.production.json");
const pageSize = 500;
const clubColumns = "id, name, short_name, created_at";
const playerColumns = "id, profixio_id, stupa_user_role_id, club_id, first_name, last_name, birth_year, ranking_position, ranking_points, price, active, created_at, source_updated_at";
const identityColumns = "provider, external_id, player_id, is_current, first_seen_at, last_seen_at";

function parseEnvFile(content) {
  const values = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const match = trimmedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    values[match[1]] = match[2]
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
  }

  return values;
}

export async function loadEnvironment(target) {
  const isStaging = target === "staging";
  const isProduction = target === "production";
  const fileName = isStaging ? ".env.staging.local"
    : isProduction ? ".env.production" : ".env.local";
  const content = await readFile(path.join(projectRoot, fileName), "utf8");
  const values = parseEnvFile(content);
  const supabaseUrl = values.SUPABASE_URL ?? values.NEXT_PUBLIC_SUPABASE_URL;
  const apiKey = isStaging ? values.NEXT_PUBLIC_SUPABASE_ANON_KEY
    : values.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !apiKey) {
    const keyName = isStaging
      ? "NEXT_PUBLIC_SUPABASE_ANON_KEY"
      : "SUPABASE_SERVICE_ROLE_KEY";
    throw new Error(`Supabase URL and ${keyName} are required in ${fileName}.`);
  }

  const url = new URL(supabaseUrl);
  if (isStaging) {
    if (values.APP_ENV !== "staging") {
      throw new Error("APP_ENV must be exactly 'staging' in .env.staging.local.");
    }
    if (!values.STAGING_PROJECT_REF) {
      throw new Error("STAGING_PROJECT_REF is required in .env.staging.local.");
    }
    if (url.hostname !== `${values.STAGING_PROJECT_REF}.supabase.co`) {
      throw new Error(
        `Staging safety check failed: ${url.hostname} does not match STAGING_PROJECT_REF.`,
      );
    }
  } else if (isProduction) {
    if (url.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) {
      throw new Error("Production safety check failed: expected a hosted Supabase URL.");
    }
    const stagingValues = parseEnvFile(
      await readFile(path.join(projectRoot, ".env.staging.local"), "utf8"),
    );
    const stagingUrl = stagingValues.SUPABASE_URL ?? stagingValues.NEXT_PUBLIC_SUPABASE_URL;
    if (stagingUrl && url.origin === new URL(stagingUrl).origin) {
      throw new Error("Production safety check failed: production URL matches staging.");
    }
  } else if (url.origin !== "http://127.0.0.1:54321") {
    throw new Error(
      "Local safety check failed: NEXT_PUBLIC_SUPABASE_URL must be http://127.0.0.1:54321.",
    );
  }

  return { apiKey, supabaseUrl };
}

function createSupabaseClient(environment) {
  return createClient(environment.supabaseUrl, environment.apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function fetchAll(createQuery, description) {
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await createQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not export ${description}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

function validateSnapshot(snapshot) {
  if (snapshot.version !== 1) throw new Error("Unsupported player snapshot version.");
  for (const key of ["clubs", "players", "playerExternalIdentities"]) {
    if (!Array.isArray(snapshot[key])) throw new Error(`Snapshot ${key} must be an array.`);
  }
  if (snapshot.clubs.length === 0 || snapshot.players.length === 0) {
    throw new Error("Refusing to use an empty player snapshot.");
  }

  const clubIds = new Set(snapshot.clubs.map((club) => club.id));
  const playerIds = new Set(snapshot.players.map((player) => player.id));
  for (const player of snapshot.players) {
    if (player.club_id && !clubIds.has(player.club_id)) {
      throw new Error(`Player ${player.id} references missing club ${player.club_id}.`);
    }
  }
  for (const identity of snapshot.playerExternalIdentities) {
    if (!playerIds.has(identity.player_id)) {
      throw new Error(
        `Identity ${identity.provider}:${identity.external_id} references a missing player.`,
      );
    }
  }
}

async function exportStagingCandidate() {
  const environment = await loadEnvironment("staging");
  const supabase = createSupabaseClient(environment);
  const [clubs, players] = await Promise.all([
    fetchAll(
      () => supabase.from("clubs").select(clubColumns).order("id"),
      "clubs",
    ),
    fetchAll(
      () =>
        supabase
          .from("players")
          .select(playerColumns)
          .order("id"),
      "players",
    ),
  ]);
  const exportedAt = new Date().toISOString();
  const playerExternalIdentities = players.flatMap((player) => {
    const seenAt = player.source_updated_at ?? player.created_at ?? exportedAt;
    return [
      player.profixio_id
        ? {
            provider: "sbtf_license",
            external_id: player.profixio_id,
            player_id: player.id,
            is_current: true,
            first_seen_at: seenAt,
            last_seen_at: seenAt,
          }
        : null,
      player.stupa_user_role_id
        ? {
            provider: "stupa_user_role",
            external_id: String(player.stupa_user_role_id),
            player_id: player.id,
            is_current: true,
            first_seen_at: seenAt,
            last_seen_at: seenAt,
          }
        : null,
    ].filter(Boolean);
  });

  const snapshot = {
    version: 1,
    source: "staging",
    exportedAt,
    clubs,
    players,
    playerExternalIdentities,
  };
  validateSnapshot(snapshot);

  const temporaryPath = `${stagingCandidatePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, stagingCandidatePath);
  console.log(
    `Exported ${players.length} players, ${clubs.length} clubs, and ` +
      `${playerExternalIdentities.length} identities from staging to ` +
      "data/player-catalogue.staging.json. The committed catalogue was not changed.",
  );
}

async function exportProductionCandidate() {
  const environment = await loadEnvironment("production");
  const supabase = createSupabaseClient(environment);
  const [clubs, players, playerExternalIdentities] = await Promise.all([
    fetchAll(
      () => supabase.from("clubs").select(clubColumns).order("id"),
      "production clubs",
    ),
    fetchAll(
      () => supabase.from("players").select(playerColumns).order("id"),
      "production players",
    ),
    fetchAll(
      () => supabase.from("player_external_identities")
        .select(identityColumns).order("provider").order("external_id"),
      "production player identities",
    ),
  ]);
  const snapshot = {
    version: 1,
    source: "production-candidate",
    exportedAt: new Date().toISOString(),
    clubs,
    players,
    playerExternalIdentities,
  };
  validateSnapshot(snapshot);

  const temporaryPath = `${productionCandidatePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, productionCandidatePath);
  console.log(
    `Exported ${players.length} players, ${clubs.length} clubs, and ` +
      `${playerExternalIdentities.length} identities from production to ` +
      "data/player-catalogue.production.json. Production and the committed catalogue were not changed.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const run = command === "export-staging-candidate" ? exportStagingCandidate
    : command === "export-production-candidate" ? exportProductionCandidate
    : command === "import-local" ? async () => {
      const { importLocalCatalogue } = await import("./import-fantasy-players.mjs");
      await importLocalCatalogue();
    } : async () => { throw new Error("Usage: node scripts/player-catalogue.mjs <export-production-candidate|export-staging-candidate|import-local>"); };
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

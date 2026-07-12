import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const STUPA_API_BASE_URL = "https://testbackend.stupaevents.com";
const STUPA_TENANT = "sbtf";
const DEFAULT_STAGE_ID = 5727;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function requireEnv(name, fallbackName) {
  const value = process.env[name] ?? process.env[fallbackName];

  if (!value) {
    const names = fallbackName ? `${name} or ${fallbackName}` : name;
    throw new Error(`Missing required environment variable: ${names}`);
  }

  return value;
}

async function loadEnvFile(filePath) {
  let content;

  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const match = trimmedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;

    process.env[key] = rawValue
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
  }
}

function integer(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function integerArray(value) {
  return Array.isArray(value) ? value.map((item) => integer(item)) : [];
}

async function fetchStage(stageId) {
  const url = new URL("/ott/v1/get_group_matches", STUPA_API_BASE_URL);
  url.searchParams.set("stage_id", String(stageId));
  url.searchParams.set("view", "standard");
  url.searchParams.set("show_matrix", "true");
  url.searchParams.set("fetch_point_system", "true");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      tenant: STUPA_TENANT,
      language: "sw",
      source: "web",
      "user-agent": "fantasy-pingisligan-results-importer/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Stupa results request failed with ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.code !== 200 || !Array.isArray(payload?.data)) {
    throw new Error(`Unexpected Stupa results response: ${payload?.msg ?? "unknown error"}`);
  }

  return payload.data.flatMap((group) => group.matches ?? []);
}

function buildImportRows(parentMatches, matchesByStupaId, playersByLicenseId, allowMissingParents = false) {
  const submatches = [];
  const playerResults = [];
  const unmatchedPlayers = new Map();
  const missingParentMatches = new Set();
  const now = new Date().toISOString();

  for (const parent of parentMatches) {
    const databaseMatch = matchesByStupaId.get(integer(parent.id));
    const completedSubmatches = (parent.sub_matches ?? []).filter(
      (submatch) => submatch?.status === "SCORED" && submatch?.id,
    );

    if (completedSubmatches.length > 0 && !databaseMatch) {
      missingParentMatches.add(integer(parent.id));
      if (!allowMissingParents) continue;
    }

    for (const submatch of completedSubmatches) {
      submatches.push({
        stupa_submatch_id: integer(submatch.id),
        match_id: databaseMatch?.id ?? null,
        match_order: integer(submatch.order, null),
        status: String(submatch.status),
        is_golden_match: Boolean(submatch.is_golden_match),
        winning_team_stupa_id: integer(submatch.winner, null),
        raw_payload: submatch,
        source_updated_at: now,
      });

      for (const [sideIndex, side] of (submatch.participants ?? []).entries()) {
        for (const detail of side.participant_details ?? []) {
          const licenseId = String(detail?.meta_data?.license_id ?? "").trim();
          const stupaUserRoleId = integer(detail?.user_role_id, null);
          if (!stupaUserRoleId || !detail?.name) continue;

          const player = licenseId ? playersByLicenseId.get(licenseId) : null;
          if (!player) {
            unmatchedPlayers.set(`${stupaUserRoleId}:${licenseId}`, {
              name: detail.name,
              licenseId: licenseId || null,
              stupaUserRoleId,
            });
          }

          playerResults.push({
            stupa_submatch_id: integer(submatch.id),
            player_id: player?.id ?? null,
            stupa_user_role_id: stupaUserRoleId,
            stupa_license_id: licenseId || null,
            player_name: String(detail.name),
            team_stupa_participant_id: integer(side.participant_id),
            side_order: integer(side.order, sideIndex + 1),
            lineup_label: detail.participant_label ?? null,
            won: integer(side.participant_id) === integer(submatch.winner),
            sets_won: integer(side.sets_won),
            sets_lost: integer(side.sets_lost),
            points_won: integer(side.points_won),
            points_lost: integer(side.points_lost),
            set_wins: integerArray(side.sets),
            set_points: integerArray(side.points),
            walkover: Boolean(side.walkover),
            raw_payload: { side, detail },
            source_updated_at: now,
          });
        }
      }
    }
  }

  return {
    submatches,
    playerResults,
    unmatchedPlayers: [...unmatchedPlayers.values()],
    missingParentMatches: [...missingParentMatches],
  };
}

async function loadDatabaseLookups(supabase) {
  const [{ data: matches, error: matchError }, { data: players, error: playerError }] =
    await Promise.all([
      supabase.from("matches").select("id, stupa_match_id").not("stupa_match_id", "is", null),
      supabase.from("players").select("id, profixio_id, stupa_user_role_id"),
    ]);

  if (matchError) throw new Error(`Could not load matches: ${matchError.message}`);
  if (playerError) throw new Error(`Could not load players: ${playerError.message}`);

  return {
    matchesByStupaId: new Map(matches.map((match) => [integer(match.stupa_match_id), match])),
    playersByLicenseId: new Map(
      players.filter((player) => player.profixio_id).map((player) => [String(player.profixio_id), player]),
    ),
  };
}

async function persistRows(supabase, rows) {
  if (rows.submatches.length > 0) {
    const { error } = await supabase
      .from("stupa_submatches")
      .upsert(rows.submatches, { onConflict: "stupa_submatch_id" });
    if (error) throw new Error(`Could not upsert submatches: ${error.message}`);
  }

  if (rows.playerResults.length > 0) {
    const { error } = await supabase
      .from("player_submatch_results")
      .upsert(rows.playerResults, { onConflict: "stupa_submatch_id,stupa_user_role_id" });
    if (error) throw new Error(`Could not upsert player results: ${error.message}`);

    const identityRows = rows.playerResults
      .filter((result) => result.player_id)
      .map((result) => ({ id: result.player_id, stupa_user_role_id: result.stupa_user_role_id }));

    if (identityRows.length > 0) {
      const uniqueIdentities = [...new Map(identityRows.map((row) => [row.id, row])).values()];
      for (const identity of uniqueIdentities) {
        const { error } = await supabase
          .from("players")
          .update({ stupa_user_role_id: identity.stupa_user_role_id })
          .eq("id", identity.id);
        if (error) throw new Error(`Could not link Stupa player identity: ${error.message}`);
      }
    }
  }
}

async function main() {
  await loadEnvFile(path.join(projectRoot, ".env.local"));
  await loadEnvFile(path.join(projectRoot, ".env"));

  const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  const stageId = integer(process.env.STUPA_STAGE_ID, DEFAULT_STAGE_ID);
  const parentMatches = await fetchStage(stageId);

  let supabase = null;
  let lookups = { matchesByStupaId: new Map(), playersByLicenseId: new Map() };

  const hasSupabaseCredentials = Boolean(
    (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (!dryRun || hasSupabaseCredentials) {
    const supabaseUrl = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    lookups = await loadDatabaseLookups(supabase);
  }

  const rows = buildImportRows(
    parentMatches,
    lookups.matchesByStupaId,
    lookups.playersByLicenseId,
    dryRun,
  );

  if (!dryRun) await persistRows(supabase, rows);

  console.log(`Fetched ${parentMatches.length} parent matches from Stupa stage ${stageId}.`);
  console.log(`${dryRun ? "Would import" : "Imported"} ${rows.submatches.length} scored submatches.`);
  console.log(`${dryRun ? "Would import" : "Imported"} ${rows.playerResults.length} player result rows.`);

  if (rows.missingParentMatches.length > 0) {
    console.warn(`Missing scheduled parent matches: ${rows.missingParentMatches.join(", ")}`);
  }
  for (const player of rows.unmatchedPlayers) {
    console.warn(
      `Unmatched Stupa player: ${player.name} (license ${player.licenseId ?? "missing"}, role ${player.stupaUserRoleId})`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

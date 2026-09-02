import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const STUPA_API_BASE_URL = "https://testbackend.stupaevents.com";
const STUPA_TENANT = "sbtf";
const DEFAULT_STAGE_ID = 5727;
const LICENSE_PROVIDER = "sbtf_license";
const ROLE_PROVIDER = "stupa_user_role";

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

function getParticipant(match, order) {
  const participants = match.participants ?? [];
  return (
    participants.find((participant) => participant.order === order) ??
    participants[order - 1]
  );
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

function buildImportRows(
  parentMatches,
  matchesByStupaId,
  playersByLicenseId,
  playersByRoleId,
  allowMissingParents = false,
) {
  const matchUpdates = [];
  const gameweekIds = new Set();
  const submatches = [];
  const playerResults = [];
  const unmatchedPlayers = new Map();
  const identityConflicts = new Map();
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

    if (databaseMatch && completedSubmatches.length > 0) {
      if (databaseMatch.fantasy_gameweek_id) {
        gameweekIds.add(databaseMatch.fantasy_gameweek_id);
      }
      matchUpdates.push({
        id: databaseMatch.id,
        home_team_stupa_participant_id: integer(
          getParticipant(parent, 1)?.participant_id,
          null,
        ),
        away_team_stupa_participant_id: integer(
          getParticipant(parent, 2)?.participant_id,
          null,
        ),
        winning_team_stupa_participant_id: integer(parent.winner, null),
        status: String(parent.status ?? "scored").toLowerCase(),
        source_updated_at: now,
      });
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

          const licensePlayer = licenseId
            ? playersByLicenseId.get(licenseId)
            : null;
          const rolePlayer = playersByRoleId.get(String(stupaUserRoleId));
          const identitiesDisagree =
            licensePlayer && rolePlayer && licensePlayer.id !== rolePlayer.id;
          const player = identitiesDisagree
            ? null
            : (licensePlayer ?? rolePlayer ?? null);

          if (identitiesDisagree) {
            identityConflicts.set(`${stupaUserRoleId}:${licenseId}`, {
              licenseId: licenseId || null,
              licensePlayerId: licensePlayer.id,
              name: detail.name,
              rolePlayerId: rolePlayer.id,
              stupaUserRoleId,
            });
          }

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
    gameweekIds: [...gameweekIds],
    matchUpdates,
    submatches,
    playerResults,
    unmatchedPlayers: [...unmatchedPlayers.values()],
    identityConflicts: [...identityConflicts.values()],
    missingParentMatches: [...missingParentMatches],
  };
}

async function loadDatabaseLookups(supabase) {
  const [
    { data: matches, error: matchError },
    { data: players, error: playerError },
    { data: identities, error: identityError },
  ] = await Promise.all([
    supabase
      .from("matches")
      .select("id, stupa_match_id, fantasy_gameweek_id")
      .not("stupa_match_id", "is", null),
    supabase.from("players").select("id, profixio_id, stupa_user_role_id"),
    supabase
      .from("player_external_identities")
      .select("provider, external_id, player_id"),
  ]);

  if (matchError) throw new Error(`Could not load matches: ${matchError.message}`);
  if (playerError) throw new Error(`Could not load players: ${playerError.message}`);
  if (identityError) {
    throw new Error(
      "Could not load player identities. Apply supabase/player-identity-migration.sql first: " +
        identityError.message,
    );
  }

  const playersById = new Map(players.map((player) => [player.id, player]));
  const playersByLicenseId = new Map();
  const playersByRoleId = new Map();

  for (const identity of identities ?? []) {
    const player = playersById.get(identity.player_id);
    if (!player) continue;

    if (identity.provider === LICENSE_PROVIDER) {
      playersByLicenseId.set(identity.external_id, player);
    } else if (identity.provider === ROLE_PROVIDER) {
      playersByRoleId.set(identity.external_id, player);
    }
  }

  for (const player of players) {
    if (player.profixio_id && !playersByLicenseId.has(String(player.profixio_id))) {
      playersByLicenseId.set(String(player.profixio_id), player);
    }
    if (
      player.stupa_user_role_id &&
      !playersByRoleId.has(String(player.stupa_user_role_id))
    ) {
      playersByRoleId.set(String(player.stupa_user_role_id), player);
    }
  }

  return {
    matchesByStupaId: new Map(matches.map((match) => [integer(match.stupa_match_id), match])),
    playersByLicenseId,
    playersByRoleId,
  };
}

async function persistPlayerIdentities(supabase, playerResults) {
  const seenAt = new Date().toISOString();
  const identitiesByKey = new Map();

  for (const result of playerResults) {
    if (!result.player_id) continue;

    if (result.stupa_license_id) {
      identitiesByKey.set(`${LICENSE_PROVIDER}:${result.stupa_license_id}`, {
        external_id: result.stupa_license_id,
        is_current: false,
        last_seen_at: seenAt,
        player_id: result.player_id,
        provider: LICENSE_PROVIDER,
      });
    }

    identitiesByKey.set(`${ROLE_PROVIDER}:${result.stupa_user_role_id}`, {
      external_id: String(result.stupa_user_role_id),
      is_current: false,
      last_seen_at: seenAt,
      player_id: result.player_id,
      provider: ROLE_PROVIDER,
    });
  }

  const identityRows = [...identitiesByKey.values()];
  if (identityRows.length === 0) return;

  for (const provider of [LICENSE_PROVIDER, ROLE_PROVIDER]) {
    const externalIds = identityRows
      .filter((identity) => identity.provider === provider)
      .map((identity) => identity.external_id);
    if (externalIds.length === 0) continue;

    const { error: updateError } = await supabase
      .from("player_external_identities")
      .update({ last_seen_at: seenAt })
      .eq("provider", provider)
      .in("external_id", externalIds);
    if (updateError) {
      throw new Error(
        `Could not refresh Stupa player identities: ${updateError.message}`,
      );
    }
  }

  const { error } = await supabase
    .from("player_external_identities")
    .upsert(identityRows, {
      ignoreDuplicates: true,
      onConflict: "provider,external_id",
    });
  if (error) {
    throw new Error(`Could not save Stupa player identities: ${error.message}`);
  }
}

async function persistRows(supabase, rows) {
  if (rows.matchUpdates.length > 0) {
    const { error } = await supabase
      .from("matches")
      .upsert(rows.matchUpdates, { onConflict: "id" });
    if (error) throw new Error(`Could not update parent matches: ${error.message}`);
  }

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

    await persistPlayerIdentities(supabase, rows.playerResults);
  }
}

async function scoreAffectedGameweeks(supabase, gameweekIds) {
  // The source response covers the full stage, so this intentionally revisits
  // earlier gameweeks whenever their results are still present in that response.
  for (const gameweekId of gameweekIds) {
    const { error } = await supabase.rpc("calculate_fantasy_gameweek_points", {
      target_gameweek_id: gameweekId,
    });
    if (error) {
      throw new Error(`Could not score fantasy gameweek ${gameweekId}: ${error.message}`);
    }
  }

  return gameweekIds.length;
}

async function main() {
  await loadEnvFile(path.join(projectRoot, ".env.local"));
  await loadEnvFile(path.join(projectRoot, ".env"));

  const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  const stageId = integer(process.env.STUPA_STAGE_ID, DEFAULT_STAGE_ID);
  const parentMatches = await fetchStage(stageId);

  let supabase = null;
  let lookups = {
    matchesByStupaId: new Map(),
    playersByLicenseId: new Map(),
    playersByRoleId: new Map(),
  };

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
    lookups.playersByRoleId,
    dryRun,
  );

  let scoredGameweekCount = 0;
  if (!dryRun) {
    if (rows.identityConflicts.length > 0) {
      const conflict = rows.identityConflicts[0];
      throw new Error(
        `Stupa license and role identities resolve to different players for ${conflict.name} ` +
          `(license ${conflict.licenseId ?? "missing"}, role ${conflict.stupaUserRoleId}). ` +
          "Run a dry run and repair the aliases before importing.",
      );
    }
    await persistRows(supabase, rows);
    scoredGameweekCount = await scoreAffectedGameweeks(supabase, rows.gameweekIds);
  }

  console.log(`Fetched ${parentMatches.length} parent matches from Stupa stage ${stageId}.`);
  console.log(`${dryRun ? "Would import" : "Imported"} ${rows.submatches.length} scored submatches.`);
  console.log(`${dryRun ? "Would import" : "Imported"} ${rows.playerResults.length} player result rows.`);
  if (!dryRun) {
    console.log(
      `Recalculated ${scoredGameweekCount} fantasy gameweeks from the full stage result set.`,
    );
  }

  if (rows.missingParentMatches.length > 0) {
    console.warn(`Missing scheduled parent matches: ${rows.missingParentMatches.join(", ")}`);
  }
  for (const player of rows.unmatchedPlayers) {
    console.warn(
      `Unmatched Stupa player: ${player.name} (license ${player.licenseId ?? "missing"}, role ${player.stupaUserRoleId})`,
    );
  }
  for (const conflict of rows.identityConflicts) {
    console.warn(
      `Conflicting Stupa identity: ${conflict.name} (license ${conflict.licenseId ?? "missing"} -> ${conflict.licensePlayerId}, role ${conflict.stupaUserRoleId} -> ${conflict.rolePlayerId})`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { buildImportRows };

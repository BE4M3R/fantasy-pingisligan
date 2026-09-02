import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROFIXIO_RANKING_URL =
  "https://www.profixio.com/fx/ranking_sbtf/ranking_sbtf_list.php?gender=m";
const PLAYERS_PER_CLUB = 10;
const MIN_RANKING_POINTS = 2250;
const PRICE_OFFSET = 2200;
const PRICE_MULTIPLIER = 100000;
const WORLD_RANK_PRICE_POOL = 25000000;
const LICENSE_PROVIDER = "sbtf_license";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const clubsFile = process.env.CLUBS_FILE
  ? path.resolve(process.env.CLUBS_FILE)
  : path.join(projectRoot, "clubs.txt");

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
    if (error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const match = trimmedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;

    if (process.env[key]) {
      continue;
    }

    process.env[key] = rawValue
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
  }
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function textFromHtml(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function searchable(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv-SE");
}

function canonicalClubName(value) {
  const normalized = searchable(value);
  const isEskilstunaByStiga = normalized.includes("eskilstuna by stiga");
  const isLindenEskilstuna =
    normalized.includes("linden") &&
    (normalized.includes("eskilstuna") || normalized.includes("esklistuna"));

  return isEskilstunaByStiga || isLindenEskilstuna
    ? "Linden BTK Eskilstuna"
    : value.trim();
}

function normalizedIdentityName(firstName, lastName) {
  return searchable(`${firstName} ${lastName}`).replace(/\s+/g, " ").trim();
}

function playerIdentityKey(player) {
  if (!Number.isInteger(player.birthYear ?? player.birth_year)) return null;

  return `${normalizedIdentityName(
    player.firstName ?? player.first_name,
    player.lastName ?? player.last_name,
  )}:${player.birthYear ?? player.birth_year}`;
}

function databaseClubName(player) {
  const club = Array.isArray(player.clubs) ? player.clubs[0] : player.clubs;
  return club?.name ?? null;
}

function splitPlayerName(name) {
  const [lastName, ...firstNameParts] = name.split(",").map((part) => part.trim());

  return {
    firstName: firstNameParts.join(", ") || name.trim(),
    lastName: firstNameParts.length > 0 ? lastName : "",
  };
}

function parsePlacement(value) {
  const worldRankingMatch = value.match(/\bWR\s*0*(\d+)\b/i);
  const worldRankingPosition = Number(worldRankingMatch?.[1]);
  const rankingPosition = Number(value.match(/(\d+)\s*$/)?.[1]);

  return {
    rankingPosition: Number.isFinite(rankingPosition) ? rankingPosition : null,
    worldRankingPosition:
      Number.isInteger(worldRankingPosition) && worldRankingPosition > 0
        ? worldRankingPosition
        : null,
  };
}

function calculatePlayerPrice(rankingPoints, worldRankingPosition) {
  const rankingPrice =
    (Math.max(MIN_RANKING_POINTS, rankingPoints) - PRICE_OFFSET) *
    PRICE_MULTIPLIER;
  const worldRankingPrice = worldRankingPosition
    ? Math.round(WORLD_RANK_PRICE_POOL / Math.sqrt(worldRankingPosition))
    : 0;

  return rankingPrice + worldRankingPrice;
}

function parseRankingRows(html) {
  const rows = [];
  const rowMatches = html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi);

  for (const rowMatch of rowMatches) {
    const rowHtml = rowMatch[1];

    if (!rowHtml.includes("rml_poeng")) {
      continue;
    }

    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => match[1],
    );

    if (cells.length < 6) {
      continue;
    }

    const profixioPlayerId = rowHtml.match(/id=['"]rml:(\d+):/)?.[1];
    const placementText = textFromHtml(cells[0]);
    const { rankingPosition, worldRankingPosition } =
      parsePlacement(placementText);
    const fullName = textFromHtml(cells[2]);
    const birthYearText = textFromHtml(cells[3]);
    const birthYear = /^\d{4}$/.test(birthYearText)
      ? Number(birthYearText)
      : null;
    const clubName = canonicalClubName(
      textFromHtml(cells[4]).replace(/\*+$/g, ""),
    );
    const rankingPoints = Number(textFromHtml(cells[5]).replace(/\D/g, ""));

    if (!profixioPlayerId || !fullName || !clubName || !rankingPoints) {
      continue;
    }

    const { firstName, lastName } = splitPlayerName(fullName);

    rows.push({
      profixioPlayerId,
      rankingPosition,
      worldRankingPosition,
      firstName,
      lastName,
      birthYear,
      clubName,
      rankingPoints,
      price: calculatePlayerPrice(rankingPoints, worldRankingPosition),
    });
  }

  return rows;
}

async function readClubSearches() {
  const content = await readFile(clubsFile, "utf8");

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function pickPlayersForClubs(rows, clubSearches) {
  const selectedById = new Map();
  const summary = [];

  for (const clubSearch of clubSearches) {
    const needle = searchable(clubSearch);
    const matches = rows
      .filter((row) => searchable(row.clubName).includes(needle))
      .slice(0, PLAYERS_PER_CLUB);

    summary.push({
      clubSearch,
      count: matches.length,
      players: matches,
    });

    for (const player of matches) {
      selectedById.set(player.profixioPlayerId, player);
    }
  }

  return {
    players: [...selectedById.values()],
    summary,
  };
}

async function upsertClub(supabase, clubName) {
  const { data, error } = await supabase
    .from("clubs")
    .upsert({ name: clubName }, { onConflict: "name" })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not upsert club "${clubName}": ${error.message}`);
  }

  return data.id;
}

async function loadPlayerIdentityState(supabase) {
  const [playerResult, identityResult] = await Promise.all([
    supabase
      .from("players")
      .select(
        "id, profixio_id, club_id, first_name, last_name, birth_year, created_at, clubs(name)",
      ),
    supabase
      .from("player_external_identities")
      .select("provider, external_id, player_id, is_current"),
  ]);

  if (playerResult.error) {
    throw new Error(`Could not load players: ${playerResult.error.message}`);
  }
  if (identityResult.error) {
    throw new Error(
      "Could not load player identities. Apply supabase/player-identity-migration.sql first: " +
        identityResult.error.message,
    );
  }

  return {
    identities: identityResult.data ?? [],
    players: playerResult.data ?? [],
  };
}

function validateSourceIdentities(players) {
  const rowsByIdentity = new Map();

  for (const player of players) {
    const identityKey = playerIdentityKey(player);
    if (!identityKey) continue;

    const key = `${identityKey}:${searchable(player.clubName)}`;
    const matches = rowsByIdentity.get(key) ?? [];
    matches.push(player);
    rowsByIdentity.set(key, matches);
  }

  for (const matches of rowsByIdentity.values()) {
    if (matches.length <= 1) continue;

    throw new Error(
      `Profixio returned the same name, birth year, and club with multiple licenses: ${matches
        .map((player) => `${player.firstName} ${player.lastName} (${player.profixioPlayerId})`)
        .join(", ")}.`,
    );
  }
}

function buildReconciliationPlan(sourcePlayers, state) {
  validateSourceIdentities(sourcePlayers);

  const playersById = new Map(state.players.map((player) => [player.id, player]));
  const playersByLicense = new Map(
    state.identities
      .filter((identity) => identity.provider === LICENSE_PROVIDER)
      .map((identity) => [identity.external_id, playersById.get(identity.player_id)]),
  );

  for (const player of state.players) {
    if (player.profixio_id && !playersByLicense.has(player.profixio_id)) {
      playersByLicense.set(player.profixio_id, player);
    }
  }

  const playersByIdentity = new Map();
  for (const player of state.players) {
    const key = playerIdentityKey(player);
    if (!key) continue;
    const matches = playersByIdentity.get(key) ?? [];
    matches.push(player);
    playersByIdentity.set(key, matches);
  }

  const claimedPlayerIds = new Set();
  const plan = [];

  for (const sourcePlayer of sourcePlayers) {
    const exactPlayer = playersByLicense.get(sourcePlayer.profixioPlayerId);
    const identityKey = playerIdentityKey(sourcePlayer);
    const identityMatches = identityKey
      ? (playersByIdentity.get(identityKey) ?? [])
      : [];
    const sameClubMatches = identityMatches.filter(
      (player) =>
        searchable(databaseClubName(player) ?? "") ===
        searchable(sourcePlayer.clubName),
    );

    let player = exactPlayer ?? null;
    let matchKind = exactPlayer ? "license" : "new";
    let duplicates = [];

    if (player) {
      duplicates = sameClubMatches.filter((candidate) => candidate.id !== player.id);
    } else if (identityMatches.length === 1) {
      [player] = identityMatches;
      matchKind = "name-and-birth-year";
    } else if (
      identityMatches.length > 1 &&
      sameClubMatches.length === identityMatches.length
    ) {
      const orderedMatches = [...sameClubMatches].sort((left, right) =>
        String(left.created_at).localeCompare(String(right.created_at)),
      );
      [player] = orderedMatches;
      duplicates = orderedMatches.slice(1);
      matchKind = "name-birth-year-and-club";
    } else if (identityMatches.length > 1) {
      throw new Error(
        `Ambiguous player identity for ${sourcePlayer.firstName} ${sourcePlayer.lastName} ` +
          `(born ${sourcePlayer.birthYear ?? "unknown"}, license ${sourcePlayer.profixioPlayerId}).`,
      );
    }

    if (player && claimedPlayerIds.has(player.id)) {
      throw new Error(
        `Two Profixio rows resolved to ${sourcePlayer.firstName} ${sourcePlayer.lastName}.`,
      );
    }
    if (player) claimedPlayerIds.add(player.id);

    plan.push({ duplicates, matchKind, player, sourcePlayer });
  }

  return plan;
}

async function ensureClubIds(supabase, players) {
  const clubIdsByName = new Map();

  for (const player of players) {
    if (!clubIdsByName.has(player.clubName)) {
      clubIdsByName.set(player.clubName, await upsertClub(supabase, player.clubName));
    }
  }

  return clubIdsByName;
}

async function setCurrentLicenseIdentity(supabase, playerId, licenseId, seenAt) {
  const { error: clearError } = await supabase
    .from("player_external_identities")
    .update({ is_current: false })
    .eq("player_id", playerId)
    .eq("provider", LICENSE_PROVIDER)
    .eq("is_current", true);

  if (clearError) {
    throw new Error(`Could not retire an old player license: ${clearError.message}`);
  }

  const { error } = await supabase.from("player_external_identities").upsert(
    {
      external_id: licenseId,
      is_current: true,
      last_seen_at: seenAt,
      player_id: playerId,
      provider: LICENSE_PROVIDER,
    },
    { onConflict: "provider,external_id" },
  );

  if (error) {
    throw new Error(`Could not save player license ${licenseId}: ${error.message}`);
  }
}

async function syncPlayers(supabase, sourcePlayers) {
  const state = await loadPlayerIdentityState(supabase);
  const plan = buildReconciliationPlan(sourcePlayers, state);
  const clubIdsByName = await ensureClubIds(supabase, sourcePlayers);
  const selectedPlayerIds = new Set();
  const summary = { created: 0, deactivated: 0, merged: 0, reidentified: 0, updated: 0 };
  const seenAt = new Date().toISOString();

  for (const item of plan) {
    let playerId = item.player?.id ?? null;

    if (playerId) {
      for (const duplicate of item.duplicates) {
        const { error } = await supabase.rpc("merge_player_records", {
          duplicate_player_id: duplicate.id,
          keep_player_id: playerId,
        });
        if (error) {
          throw new Error(
            `Could not merge duplicate ${item.sourcePlayer.firstName} ${item.sourcePlayer.lastName}: ${error.message}`,
          );
        }
        summary.merged += 1;
      }
    }

    const payload = {
      active: true,
      birth_year: item.sourcePlayer.birthYear,
      club_id: clubIdsByName.get(item.sourcePlayer.clubName),
      first_name: item.sourcePlayer.firstName,
      last_name: item.sourcePlayer.lastName,
      price: item.sourcePlayer.price,
      profixio_id: item.sourcePlayer.profixioPlayerId,
      ranking_points: item.sourcePlayer.rankingPoints,
      ranking_position: item.sourcePlayer.rankingPosition,
      source_updated_at: seenAt,
    };

    if (playerId) {
      const { error } = await supabase
        .from("players")
        .update(payload)
        .eq("id", playerId);
      if (error) {
        throw new Error(
          `Could not update ${item.sourcePlayer.firstName} ${item.sourcePlayer.lastName}: ${error.message}`,
        );
      }
      summary.updated += 1;
      if (item.matchKind !== "license") summary.reidentified += 1;
    } else {
      const { data, error } = await supabase
        .from("players")
        .insert(payload)
        .select("id")
        .single();
      if (error) {
        throw new Error(
          `Could not create ${item.sourcePlayer.firstName} ${item.sourcePlayer.lastName}: ${error.message}`,
        );
      }
      playerId = data.id;
      summary.created += 1;
    }

    await setCurrentLicenseIdentity(
      supabase,
      playerId,
      item.sourcePlayer.profixioPlayerId,
      seenAt,
    );
    selectedPlayerIds.add(playerId);
  }

  const { data: managedIdentities, error: managedError } = await supabase
    .from("player_external_identities")
    .select("player_id")
    .eq("provider", LICENSE_PROVIDER);
  if (managedError) {
    throw new Error(`Could not load managed players: ${managedError.message}`);
  }

  const inactivePlayerIds = [
    ...new Set((managedIdentities ?? []).map((identity) => identity.player_id)),
  ].filter((playerId) => !selectedPlayerIds.has(playerId));

  if (inactivePlayerIds.length > 0) {
    const { data, error } = await supabase
      .from("players")
      .update({ active: false })
      .in("id", inactivePlayerIds)
      .eq("active", true)
      .select("id");
    if (error) {
      throw new Error(`Could not deactivate missing players: ${error.message}`);
    }
    summary.deactivated = data?.length ?? 0;
  }

  return summary;
}

async function previewPlayerSync(supabase, sourcePlayers) {
  const state = await loadPlayerIdentityState(supabase);
  const plan = buildReconciliationPlan(sourcePlayers, state);
  const selectedPlayerIds = new Set(
    plan.filter((item) => item.player).map((item) => item.player.id),
  );
  const mergedPlayerIds = new Set(
    plan.flatMap((item) => item.duplicates.map((player) => player.id)),
  );
  const managedPlayerIds = new Set(
    state.identities
      .filter((identity) => identity.provider === LICENSE_PROVIDER)
      .map((identity) => identity.player_id),
  );

  return {
    created: plan.filter((item) => !item.player).length,
    deactivated: [...managedPlayerIds].filter(
      (playerId) =>
        !selectedPlayerIds.has(playerId) && !mergedPlayerIds.has(playerId),
    ).length,
    merged: plan.reduce((count, item) => count + item.duplicates.length, 0),
    reidentified: plan.filter(
      (item) => item.player && item.matchKind !== "license",
    ).length,
    updated: plan.filter((item) => item.player).length,
  };
}

async function getPendingRefreshGameweek(supabase) {
  const now = new Date().toISOString();
  const { data: gameweek, error } = await supabase
    .from("fantasy_gameweeks")
    .select("id, name, lock_at, unlock_at")
    .lte("lock_at", now)
    .is("data_refreshed_at", null)
    .order("unlock_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not check pending gameweek refreshes: ${error.message}`);
  }

  return gameweek;
}

async function hasStartedGameweek(supabase) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("fantasy_gameweeks")
    .select("id")
    .lte("lock_at", now)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not inspect gameweek state: ${error.message}`);
  }

  return Boolean(data);
}

async function markGameweekRefreshed(supabase, gameweek) {
  const refreshedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("fantasy_gameweeks")
    .update({ data_refreshed_at: refreshedAt, updated_at: refreshedAt })
    .eq("id", gameweek.id)
    .is("data_refreshed_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not reopen transfers: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      `${gameweek.name} was already marked refreshed by another process.`,
    );
  }

  console.log(`Refreshed ${gameweek.name}; transfers are open.`);
}

async function main() {
  await loadEnvFile(path.join(projectRoot, ".env.local"));
  await loadEnvFile(path.join(projectRoot, ".env"));

  const dryRun =
    process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  const afterUnlock = process.argv.includes("--after-unlock");
  let supabase = null;
  let refreshGameweek = null;

  const hasSupabaseCredentials = Boolean(
    (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (!dryRun || hasSupabaseCredentials) {
    const supabaseUrl = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  if (!dryRun) {
    const pendingGameweek = await getPendingRefreshGameweek(supabase);

    if (afterUnlock) {
      if (!pendingGameweek) {
        console.log("No gameweek is waiting for a data refresh; skipping.");
        return;
      }

      if (Date.now() <= Date.parse(pendingGameweek.unlock_at)) {
        console.log(
          `${pendingGameweek.name} is still active until ${pendingGameweek.unlock_at}; ` +
            "skipping scheduled price refresh.",
        );
        return;
      }

      refreshGameweek = pendingGameweek;
      console.log(`Refreshing player prices after ${pendingGameweek.name}.`);
    } else {
      if (pendingGameweek) {
        throw new Error(
          `${pendingGameweek.name} is locked or waiting for its data refresh. ` +
            "Import results first, then run the player importer with --after-unlock.",
        );
      }

      if (await hasStartedGameweek(supabase)) {
        throw new Error(
          "In-season prices may only refresh after a gameweek unlock. " +
            "Use --after-unlock after importing results.",
        );
      }
    }
  }

  const clubSearches = await readClubSearches();

  if (clubSearches.length === 0) {
    throw new Error(`No clubs found in ${clubsFile}`);
  }

  const response = await fetch(PROFIXIO_RANKING_URL, {
    headers: {
      "user-agent": "fantasy-pingisligan-importer/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Could not fetch Profixio ranking page: ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();
  const rankingRows = parseRankingRows(html);
  const { players, summary } = pickPlayersForClubs(rankingRows, clubSearches);
  validateSourceIdentities(players);

  if (!dryRun && players.length === 0) {
    throw new Error("No players were parsed; transfers will remain locked.");
  }
  if (!dryRun && summary.some((club) => club.count === 0)) {
    throw new Error(
      "At least one configured club returned no players; refusing to deactivate the previous roster.",
    );
  }

  let syncSummary = null;
  if (!dryRun) {
    syncSummary = await syncPlayers(supabase, players);

    if (refreshGameweek) {
      await markGameweekRefreshed(supabase, refreshGameweek);
    }
  } else if (supabase) {
    syncSummary = await previewPlayerSync(supabase, players);
  }

  console.log(`Read ${clubSearches.length} club search strings from ${clubsFile}`);
  console.log(`Parsed ${rankingRows.length} players from the first Profixio page`);
  console.log(`${dryRun ? "Would upsert" : "Upserted"} ${players.length} unique players`);

  if (syncSummary) {
    console.log(
      `${dryRun ? "Would create" : "Created"} ${syncSummary.created}, ` +
        `${dryRun ? "update" : "updated"} ${syncSummary.updated}, ` +
        `${dryRun ? "reidentify" : "reidentified"} ${syncSummary.reidentified}, and ` +
        `${dryRun ? "merge" : "merged"} ${syncSummary.merged} player records.`,
    );
    console.log(
      `${dryRun ? "Would mark" : "Marked"} ${syncSummary.deactivated} missing players inactive.`,
    );
  }

  for (const item of summary) {
    console.log(`${item.clubSearch}: ${item.count}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { buildReconciliationPlan, playerIdentityKey, validateSourceIdentities };

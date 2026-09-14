import { canonicalClubName } from "../lib/clubs.ts";
import { getOrCreateClubId, findExistingClub } from "./club-identity.mjs";
import roster from "../data/sbtf-rosters.json" with { type: "json" };
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROFIXIO_RANKING_URL =
  "https://www.profixio.com/fx/ranking_sbtf/ranking_sbtf_list.php?gender=m";
const MIN_RANKING_POINTS = 2250;
const PRICE_OFFSET = 2200;
const PRICE_MULTIPLIER = 100000;
const WORLD_RANK_PRICE_POOL = 25000000;
const LICENSE_PROVIDER = "sbtf_license";

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
    rankingPosition: Number.isFinite(rankingPosition) && rankingPosition > 0 ? rankingPosition : null,
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

export function matchRosterPlayer(entry, rows) {
  const names = new Set([entry.rankingName, ...(entry.rankingAliases ?? [])].map(searchable));
  const candidates = rows.filter((row) => row.profixioPlayerId === entry.licenseId ||
    (names.has(searchable(`${row.firstName} ${row.lastName}`)) &&
      (entry.birthYear === null || row.birthYear === entry.birthYear)));
  // A renewed license can leave an inactive row behind. Prefer the active identity.
  const active = candidates.filter((row) => row.rankingPosition !== null);
  const unique = [...new Map((active.length ? active : candidates)
    .map((row) => [row.profixioPlayerId, row])).values()];
  if (unique.length > 1) throw new Error(`Ambiguous ranking identity for ${entry.name}`);
  return unique[0] ?? null;
}

export function selectRosterPlayers(squads, rows) {
  const players = [];
  const missing = [];
  if (!squads.length) throw new Error("The SBTF roster has no clubs.");
  for (const squad of squads) {
    if (!squad.players.length) throw new Error(`Empty SBTF squad: ${squad.club}`);
    for (const entry of squad.players) {
      const match = matchRosterPlayer(entry, rows);
      if (!match) {
        if (entry.licenseId || !entry.playerId || !Number.isFinite(entry.manualPrice)) {
          throw new Error(`Previously ranked roster player missing: ${entry.name}; refusing a partial import.`);
        }
        missing.push({ ...entry, club: squad.club });
        players.push({
          rosterPlayerId: entry.playerId,
          firstName: entry.firstName,
          lastName: entry.lastName,
          birthYear: entry.birthYear,
          clubName: canonicalClubName(squad.club),
          profixioPlayerId: null,
          rankingPoints: null,
          rankingPosition: null,
          worldRankingPosition: null,
          price: entry.manualPrice,
        });
        continue;
      }
      // SBTF controls membership; Profixio controls identity, points and price.
      players.push({ ...match, rosterPlayerId: entry.playerId, clubName: canonicalClubName(squad.club) });
    }
  }
  if (!players.length) throw new Error("No ranked SBTF roster players found.");
  validateSourceIdentities(players);
  return { players, missing };
}

async function fetchRankingPage(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "fantasy-pingisligan-importer/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Profixio ranking request failed: ${response.status}`);
  const html = await response.text();
  if (!html.includes("searchform") || !html.includes("ranking_sbtf_list.php")) {
    throw new Error("Unexpected Profixio ranking response.");
  }
  return html;
}

export async function fetchRosterPlayers() {
  const html = await fetchRankingPage(PROFIXIO_RANKING_URL);
  const rankingRun = html.match(/name=['"]rid['"][^>]*>\s*<option value=['"](\d+)/)?.[1];
  if (!rankingRun) throw new Error("Could not determine the current Profixio ranking run.");
  const rows = parseRankingRows(html);
  if (!rows.length) throw new Error("Empty Profixio ranking page.");
  // The first page normally covers almost the whole squad. Name searches cover
  // lower-ranked and inactive players without downloading every ranking page.
  for (const squad of roster.clubs) {
    for (const entry of squad.players) {
      if (matchRosterPlayer(entry, rows)) continue;
      for (const field of ["fn", "ln"]) {
        const url = new URL(PROFIXIO_RANKING_URL);
        url.searchParams.set("rid", rankingRun);
        url.searchParams.set("searching", "1");
        url.searchParams.set(field, entry.rankingName.split(" ")[0]);
        rows.push(...parseRankingRows(await fetchRankingPage(url)));
        if (matchRosterPlayer(entry, rows)) break;
      }
    }
  }
  return { ...selectRosterPlayers(roster.clubs, rows), rankingRun };
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
      "Could not load player identities. Deploy pending Supabase migrations first: " +
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
  const seenIds = new Set();

  for (const player of players) {
    const sourceId = player.profixioPlayerId ?? player.rosterPlayerId;
    if (sourceId && seenIds.has(sourceId)) throw new Error(`Duplicate roster player ID: ${sourceId}`);
    if (sourceId) seenIds.add(sourceId);
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
    const licensePlayer = playersByLicense.get(sourcePlayer.profixioPlayerId);
    const rosterPlayer = playersById.get(sourcePlayer.rosterPlayerId);
    const exactPlayer = rosterPlayer ?? licensePlayer;
    if (rosterPlayer?.profixio_id && !sourcePlayer.profixioPlayerId) {
      throw new Error(`Ranking disappeared for ${sourcePlayer.firstName} ${sourcePlayer.lastName}; refusing to restore a manual price.`);
    }
    const identityKey = playerIdentityKey(sourcePlayer);
    const identityMatches = identityKey
      ? (playersByIdentity.get(identityKey) ?? [])
      : [];
    const sameClubMatches = identityMatches.filter(
      (player) =>
        searchable(canonicalClubName(databaseClubName(player) ?? "")) ===
        searchable(canonicalClubName(sourcePlayer.clubName)),
    );

    let player = exactPlayer ?? null;
    let matchKind = exactPlayer ? "license" : "new";
    let duplicates = [];

    if (player) {
      duplicates = sameClubMatches.filter((candidate) => candidate.id !== player.id);
      if (licensePlayer && licensePlayer.id !== player.id &&
          !duplicates.some((candidate) => candidate.id === licensePlayer.id)) {
        duplicates.push(licensePlayer);
      }
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
  const { data: clubs, error } = await supabase.from("clubs").select("id, name");
  if (error) throw new Error(`Could not load clubs: ${error.message}`);
  // Check every alias before the first write. Never create a second club for a known alias.
  for (const player of players) findExistingClub(clubs, player.clubName);

  for (const player of players) {
    if (!clubIdsByName.has(player.clubName)) {
      clubIdsByName.set(player.clubName, await getOrCreateClubId(supabase, clubs, player.clubName));
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
        .insert({ ...payload, ...(item.sourcePlayer.rosterPlayerId ? { id: item.sourcePlayer.rosterPlayerId } : {}) })
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

    if (item.sourcePlayer.profixioPlayerId) {
      await setCurrentLicenseIdentity(supabase, playerId, item.sourcePlayer.profixioPlayerId, seenAt);
    }
    selectedPlayerIds.add(playerId);
  }

  const inactivePlayerIds = state.players.map((player) => player.id)
    .filter((playerId) => !selectedPlayerIds.has(playerId));

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
  const managedPlayerIds = new Set(state.players.map((player) => player.id));

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

  const { players, missing, rankingRun } = await fetchRosterPlayers();
  validateSourceIdentities(players);
  console.log(`SBTF ${roster.season} roster; Profixio ranking run ${rankingRun}.`);
  for (const player of missing) {
    console.warn(`Manual price ${player.manualPrice}: ${player.name} — ${player.club} (no ranking)`);
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

  console.log(`Read ${roster.clubs.length} SBTF squads from data/sbtf-rosters.json`);
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

  for (const item of roster.clubs) {
    console.log(`${item.club}: ${players.filter((player) => player.clubName === item.club).length}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { buildReconciliationPlan, playerIdentityKey, validateSourceIdentities, parseRankingRows, calculatePlayerPrice };

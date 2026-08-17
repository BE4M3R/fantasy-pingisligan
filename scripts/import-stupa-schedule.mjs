import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  localDateTimeToUtcIso,
  nextStockholmMidnightUtcIso,
} from "./stockholm-time.mjs";

const STUPA_API_BASE_URL = "https://testbackend.stupaevents.com";
const STUPA_TENANT = "sbtf";
const DEFAULT_STAGE_ID = 5727;
const LOCK_WINDOW_HOURS = 2;

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

function addHours(isoValue, hours) {
  return new Date(new Date(isoValue).getTime() + hours * 60 * 60 * 1000)
    .toISOString();
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
      "user-agent": "fantasy-pingisligan-schedule-importer/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Stupa schedule request failed with ${response.status}`);
  }

  const payload = await response.json();

  if (payload?.code !== 200 || !Array.isArray(payload?.data)) {
    throw new Error(`Unexpected Stupa schedule response: ${payload?.msg ?? "unknown error"}`);
  }

  return payload.data
    .flatMap((group) => group.matches ?? [])
    .filter((match) => !match.is_deleted);
}

function getParticipant(match, order) {
  const participants = match.participants ?? [];
  return (
    participants.find((participant) => participant.order === order) ??
    participants[order - 1]
  );
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function getParticipantName(match, order) {
  const participantName = getParticipant(match, order)?.participant_name?.trim() ?? null;

  return participantName ? canonicalClubName(participantName) : null;
}

function buildGameweeks(matches, stageId) {
  const byRoundId = new Map();

  for (const match of matches) {
    const endTime = match.end_time ?? match.slot?.end_time;
    if (!match.round_id || !match.start_time || !endTime) {
      continue;
    }

    const startsAt = localDateTimeToUtcIso(match.start_time);
    const endsAt = localDateTimeToUtcIso(endTime);
    const current = byRoundId.get(match.round_id) ?? {
      stupa_stage_id: stageId,
      stupa_round_id: match.round_id,
      name: match.round?.name ?? `Round ${match.round_id}`,
      round_order: match.round?.order ?? null,
      first_match_starts_at: startsAt,
      last_match_ends_at: endsAt,
    };

    if (new Date(startsAt) < new Date(current.first_match_starts_at)) {
      current.first_match_starts_at = startsAt;
    }

    if (new Date(endsAt) > new Date(current.last_match_ends_at)) {
      current.last_match_ends_at = endsAt;
    }

    byRoundId.set(match.round_id, current);
  }

  return [...byRoundId.values()]
    .map((gameweek) => ({
      ...gameweek,
      lock_at: addHours(gameweek.first_match_starts_at, -LOCK_WINDOW_HOURS),
      unlock_at: nextStockholmMidnightUtcIso(gameweek.last_match_ends_at),
      imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))
    .sort((left, right) => (left.round_order ?? 0) - (right.round_order ?? 0));
}

async function getClubs(supabase) {
  const { data, error } = await supabase.from("clubs").select("id, name");

  if (error) {
    throw new Error(`Could not fetch clubs: ${error.message}`);
  }

  return data ?? [];
}

function findExistingClubId(clubs, clubName) {
  const needle = searchable(clubName);
  const match = clubs.find((club) => {
    const haystack = searchable(club.name);
    return haystack === needle || haystack.includes(needle) || needle.includes(haystack);
  });

  return match?.id ?? null;
}

async function getOrCreateClubId(supabase, clubs, clubName) {
  if (!clubName) {
    return null;
  }

  const existingId = findExistingClubId(clubs, clubName);

  if (existingId) {
    return existingId;
  }

  const { data, error } = await supabase
    .from("clubs")
    .upsert({ name: clubName }, { onConflict: "name" })
    .select("id, name")
    .single();

  if (error) {
    throw new Error(`Could not upsert club "${clubName}": ${error.message}`);
  }

  clubs.push(data);
  return data.id;
}

async function upsertGameweeks(supabase, gameweeks) {
  const { data, error } = await supabase
    .from("fantasy_gameweeks")
    .upsert(gameweeks, { onConflict: "stupa_round_id" })
    .select("id, stupa_round_id, name, lock_at, unlock_at");

  if (error) {
    throw new Error(`Could not upsert gameweeks: ${error.message}`);
  }

  return new Map(data.map((gameweek) => [gameweek.stupa_round_id, gameweek]));
}

async function upsertMatches(supabase, matches, gameweeksByRoundId, stageId) {
  const clubs = await getClubs(supabase);
  const payload = [];

  for (const match of matches) {
    const homeTeam = getParticipant(match, 1);
    const awayTeam = getParticipant(match, 2);
    const homeTeamName = getParticipantName(match, 1);
    const awayTeamName = getParticipantName(match, 2);
    const startsAt = localDateTimeToUtcIso(match.start_time);
    const endsAt = localDateTimeToUtcIso(match.end_time ?? match.slot?.end_time);

    if (!match.id || !match.round_id || !startsAt || !endsAt) {
      continue;
    }

    payload.push({
      profixio_id: `stupa:${match.id}`,
      stupa_match_id: match.id,
      fantasy_gameweek_id: gameweeksByRoundId.get(match.round_id)?.id ?? null,
      stupa_event_match_id: match.event_match_id ?? null,
      stupa_stage_id: stageId,
      stupa_round_id: match.round_id,
      stupa_group_id: match.group_id ?? null,
      home_team_stupa_participant_id: nullableInteger(homeTeam?.participant_id),
      away_team_stupa_participant_id: nullableInteger(awayTeam?.participant_id),
      winning_team_stupa_participant_id: nullableInteger(match.winner),
      home_club_id: await getOrCreateClubId(supabase, clubs, homeTeamName),
      away_club_id: await getOrCreateClubId(supabase, clubs, awayTeamName),
      home_team_name: homeTeamName,
      away_team_name: awayTeamName,
      starts_at: startsAt,
      ends_at: endsAt,
      status: String(match.status ?? "scheduled").toLowerCase(),
      source_updated_at: new Date().toISOString(),
    });
  }

  const { error } = await supabase
    .from("matches")
    .upsert(payload, { onConflict: "stupa_match_id" });

  if (error) {
    throw new Error(`Could not upsert matches: ${error.message}`);
  }

  return payload.length;
}

async function main() {
  await loadEnvFile(path.join(projectRoot, ".env.local"));
  await loadEnvFile(path.join(projectRoot, ".env"));

  const dryRun =
    process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  const stageId = Number.parseInt(process.env.STUPA_STAGE_ID ?? String(DEFAULT_STAGE_ID), 10);
  if (!Number.isInteger(stageId)) {
    throw new Error("STUPA_STAGE_ID must be an integer.");
  }

  const matches = await fetchStage(stageId);
  const gameweeks = buildGameweeks(matches, stageId);

  console.log(`Fetched ${matches.length} Stupa matches from stage ${stageId}.`);
  console.log(`Built ${gameweeks.length} fantasy gameweeks.`);

  for (const gameweek of gameweeks) {
    console.log(
      `${gameweek.name}: lock ${gameweek.lock_at}, unlock ${gameweek.unlock_at}`,
    );
  }

  if (dryRun) {
    return;
  }

  const supabaseUrl = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const gameweeksByRoundId = await upsertGameweeks(supabase, gameweeks);
  const importedMatches = await upsertMatches(supabase, matches, gameweeksByRoundId, stageId);

  console.log(`Imported ${gameweeks.length} gameweeks and ${importedMatches} matches.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

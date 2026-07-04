import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const STUPA_API_BASE_URL = "https://testbackend.stupaevents.com";
const STUPA_TENANT = "sbtf";
const STUPA_EVENT_ID = 417;
const STUPA_CATEGORY_ID = 1118;
const STUPA_EVENT_CATEGORY_ID = 3809;
const SOURCE_TIME_ZONE = "Europe/Stockholm";
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

function getOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const timeZoneName = parts.find((part) => part.type === "timeZoneName")?.value;
  const match = timeZoneName?.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);

  if (!match) {
    throw new Error(`Could not determine ${timeZone} offset for ${date.toISOString()}`);
  }

  const [, sign, hours, minutes = "0"] = match;
  const offset = Number(hours) * 60 + Number(minutes);
  return sign === "-" ? -offset : offset;
}

function localDateTimeToUtcIso(value, timeZone = SOURCE_TIME_ZONE) {
  if (!value) {
    return null;
  }

  if (/[zZ]|[+-]\d\d:?\d\d$/.test(value)) {
    return new Date(value).toISOString();
  }

  const [datePart, timePart = "00:00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = timePart.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const firstOffset = getOffsetMinutes(utcGuess, timeZone);
  const firstDate = new Date(utcGuess.getTime() - firstOffset * 60 * 1000);
  const secondOffset = getOffsetMinutes(firstDate, timeZone);

  if (secondOffset === firstOffset) {
    return firstDate.toISOString();
  }

  return new Date(utcGuess.getTime() - secondOffset * 60 * 1000).toISOString();
}

function addHours(isoValue, hours) {
  return new Date(new Date(isoValue).getTime() + hours * 60 * 60 * 1000)
    .toISOString();
}

async function fetchStupaMatches() {
  const url = new URL("/ott/v1/matches", STUPA_API_BASE_URL);
  url.searchParams.set("event_id", String(STUPA_EVENT_ID));
  url.searchParams.set("event_category_id", String(STUPA_EVENT_CATEGORY_ID));
  url.searchParams.set("category_id", String(STUPA_CATEGORY_ID));

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      tenant: STUPA_TENANT,
    },
  });

  if (!response.ok) {
    throw new Error(`Stupa schedule request failed with ${response.status}`);
  }

  const matches = await response.json();

  if (!Array.isArray(matches)) {
    throw new Error("Stupa schedule response was not an array.");
  }

  return matches.filter((match) => !match.is_deleted);
}

function getParticipantName(match, order) {
  return match.participants
    ?.find((participant) => participant.order === order)
    ?.participant_name?.trim() ?? null;
}

function buildGameweeks(matches) {
  const byRoundId = new Map();

  for (const match of matches) {
    if (!match.round_id || !match.start_time || !match.end_time) {
      continue;
    }

    const startsAt = localDateTimeToUtcIso(match.start_time);
    const endsAt = localDateTimeToUtcIso(match.end_time);
    const current = byRoundId.get(match.round_id) ?? {
      stupa_event_id: STUPA_EVENT_ID,
      stupa_event_category_id: STUPA_EVENT_CATEGORY_ID,
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
      unlock_at: addHours(gameweek.last_match_ends_at, LOCK_WINDOW_HOURS),
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

async function upsertMatches(supabase, matches, gameweeksByRoundId) {
  const clubs = await getClubs(supabase);
  const payload = [];

  for (const match of matches) {
    const homeTeamName = getParticipantName(match, 1);
    const awayTeamName = getParticipantName(match, 2);
    const startsAt = localDateTimeToUtcIso(match.start_time);
    const endsAt = localDateTimeToUtcIso(match.end_time);

    if (!match.id || !match.round_id || !startsAt || !endsAt) {
      continue;
    }

    payload.push({
      profixio_id: `stupa:${match.id}`,
      stupa_match_id: match.id,
      fantasy_gameweek_id: gameweeksByRoundId.get(match.round_id)?.id ?? null,
      stupa_event_match_id: match.event_match_id ?? null,
      stupa_event_id: STUPA_EVENT_ID,
      stupa_event_category_id: STUPA_EVENT_CATEGORY_ID,
      stupa_round_id: match.round_id,
      stupa_group_id: match.group_id ?? null,
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
  const matches = await fetchStupaMatches();
  const gameweeks = buildGameweeks(matches);

  console.log(`Fetched ${matches.length} Stupa matches.`);
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
  const importedMatches = await upsertMatches(supabase, matches, gameweeksByRoundId);

  console.log(`Imported ${gameweeks.length} gameweeks and ${importedMatches} matches.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

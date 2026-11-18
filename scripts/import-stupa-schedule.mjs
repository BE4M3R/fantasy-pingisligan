import { importEnvironment } from "./environment.mjs";
import { canonicalClubName } from "../lib/clubs.ts";
import { findExistingClub } from "./club-identity.mjs";
import { initializeBuckets, normalizeSchedule, validatePeriods } from "./gameweek-buckets.mjs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const STUPA_API_BASE_URL = "https://testbackend.stupaevents.com";
const STUPA_TENANT = "sbtf";
const DEFAULT_STAGE_ID = 5727;

function requireEnv(name, fallbackName) {
  const value = process.env[name] ?? process.env[fallbackName];

  if (!value) {
    const names = fallbackName ? `${name} or ${fallbackName}` : name;
    throw new Error(`Missing required environment variable: ${names}`);
  }

  return value;
}

export async function fetchStage(stageId) {
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
    .flatMap((group) => group.matches ?? []);
}

// Kept for callers that preview deadlines; reopening may now change after lock.
export function preserveLockedGameweekBoundaries(gameweeks, existingGameweeks, refreshedAt = new Date().toISOString()) {
  const existing = new Map(existingGameweeks.map(w => [w.stupa_round_id, w]));
  return gameweeks.map(w => {
    const old = existing.get(w.stupa_round_id);
    if (!old) return w;
    if (old.data_refreshed_at) return { ...w, lock_at: old.lock_at, unlock_at: old.unlock_at };
    return Date.parse(old.lock_at) <= Date.parse(refreshedAt) ? { ...w, lock_at: old.lock_at } : w;
  });
}

export function buildGameweeks(matches, stageId) {
  return initializeBuckets(normalizeSchedule(matches, stageId), stageId);
}

export async function planSchedule(supabase, matches, stageId) {
  const fixtures = normalizeSchedule(matches, stageId).map(m => ({ ...m,
    home_team_name: m.home_team_name ? canonicalClubName(m.home_team_name) : null,
    away_team_name: m.away_team_name ? canonicalClubName(m.away_team_name) : null,
  }));
  const { data: existing, error } = await supabase.from("fantasy_gameweeks")
    .select("id, stupa_round_id, stupa_stage_id, round_order, name, anchor_week, anchor_at, bucket_starts_at, bucket_ends_at, bucket_initialized_at")
    .eq("stupa_stage_id", stageId).order("round_order");
  if (error) throw new Error(`Could not load gameweek periods: ${error.message}`);
  const initialized = (existing ?? []).filter(w => w.bucket_initialized_at);
  const { data: clubs, error: clubError } = await supabase.from("clubs").select("id, name");
  if (clubError) throw new Error(`Could not load clubs: ${clubError.message}`);
  for (const fixture of fixtures) {
    fixture.home_club_id = fixture.home_team_name ? findExistingClub(clubs ?? [], fixture.home_team_name)?.id ?? null : null;
    fixture.away_club_id = fixture.away_team_name ? findExistingClub(clubs ?? [], fixture.away_team_name)?.id ?? null : null;
  }
  let gameweeks;
  if (initialized.length) {
    validatePeriods(initialized);
    const known = new Map((existing ?? []).map(w => [w.stupa_round_id, w]));
    for (const m of fixtures) {
      const w = known.get(m.stupa_round_id);
      if (!w || w.round_order !== m.round_order) throw new Error(`Unexpected or reordered STUPA round ${m.stupa_round_id}; explicit bucket amendment required.`);
    }
    gameweeks = existing;
  } else {
    gameweeks = initializeBuckets(fixtures, stageId);
  }
  return { fixtures, gameweeks };
}

export async function persistSchedule(supabase, matches, stageId) {
  const { fixtures, gameweeks } = await planSchedule(supabase, matches, stageId);
  const { data, error: writeError } = await supabase.rpc("persist_gameweek_schedule", {
    p_stage_id: stageId, p_gameweeks: gameweeks, p_matches: fixtures,
  });
  if (writeError) throw new Error(`Schedule import rejected: ${writeError.message}${writeError.details ? `; ${writeError.details}` : ""}`);
  return { gameweeks, importedMatches: data.imported_matches, moves: data.moves };
}

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const githubActions = process.env.GITHUB_ACTIONS === "true";
export async function reportScheduleError(error) {
  const message = error.message ?? String(error);
  const escape = s => s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  if (githubActions) console.error(`::error title=Gameweek schedule requires manual resolution::${escape(message)}`);
  else console.error(message);
  if (summaryFile) await appendFile(summaryFile, `\n## Gameweek schedule import failed\n\n${message.replaceAll("<", "&lt;")}\n\nNo partial schedule changes were committed. Review the reported fixtures, anchors or lifecycle states before retrying.\n`);
}

async function main() {
  const environment = await importEnvironment(process.argv.slice(2));
  // Selected environment only; unrelated inherited credentials are not used.
  process.env = { ...environment };

  const dryRun =
    process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  const stageId = Number.parseInt(process.env.STUPA_STAGE_ID ?? String(DEFAULT_STAGE_ID), 10);
  if (!Number.isInteger(stageId)) {
    throw new Error("STUPA_STAGE_ID must be an integer.");
  }

  const matches = await fetchStage(stageId);
  console.log(`Fetched ${matches.length} Stupa matches from stage ${stageId}.`);
  const supabaseUrl = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  if (dryRun) {
    const { gameweeks } = await planSchedule(supabase, matches, stageId);
    for (const week of gameweeks) console.log(`${week.name}: ${week.bucket_starts_at ?? "unbounded / protected legacy"} to ${week.bucket_ends_at ?? "unbounded / protected legacy"}`);
    console.log("Schedule preview only; no database writes.");
    return;
  }
  const { importedMatches, gameweeks: stored } = await persistSchedule(supabase, matches, stageId);

  console.log(`Imported ${stored.length} gameweeks and ${importedMatches} matches.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    await reportScheduleError(error);
    process.exitCode = 1;
  });
}

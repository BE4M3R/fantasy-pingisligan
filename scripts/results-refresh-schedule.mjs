// Uses only Node built-ins so idle Actions runs can skip npm ci and STUPA.
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localDateTimeToUtcIso, nextStockholmMidnightUtcIso, STOCKHOLM_TIME_ZONE } from "./stockholm-time.mjs";

export const DAILY_RESULTS_CRON = "7 0 * * *";
const DEFAULT_STAGE_ID = 5727;

export function stockholmDayWindow(now) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid refresh-check time.");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: STOCKHOLM_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    localDate,
    start: localDateTimeToUtcIso(`${localDate}T00:00:00`),
    end: nextStockholmMidnightUtcIso(date),
  };
}

export function resultsRefreshDecision({ now, eventName, schedule, matchStarts = [] }) {
  const window = stockholmDayWindow(now);
  // Use the triggering cron, not the runner's clock: a delayed daily job
  // must still run even if it starts well after midnight.
  if (eventName === "workflow_dispatch" || (eventName === "schedule" && schedule === DAILY_RESULTS_CRON)) {
    return { shouldRun: true, refreshSchedule: true, reason: eventName === "workflow_dispatch" ? "Manual refresh" : "Daily 00:07 refresh", ...window };
  }
  if (eventName !== "schedule") throw new Error(`Unsupported refresh event: ${eventName}`);
  const matchStartedToday = matchStarts.some((startsAt) => {
    const start = Date.parse(startsAt);
    return start >= Date.parse(window.start) && start < Date.parse(window.end) && start <= new Date(now).getTime();
  });
  return {
    shouldRun: matchStartedToday,
    refreshSchedule: false,
    reason: matchStartedToday ? "Match day: first fixture has started; poll until Stockholm midnight" : "No fixture has started today; wait for a match or the daily 00:07 refresh",
    ...window,
  };
}

export async function checkResultsRefresh({ now = new Date(), eventName, schedule, supabaseUrl, serviceKey, stageId = DEFAULT_STAGE_ID, fetchImpl = fetch }) {
  const base = resultsRefreshDecision({ now, eventName, schedule });
  if (base.shouldRun) return base;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase URL and service-role key are required for the match-day check.");
  if (!Number.isSafeInteger(stageId)) throw new Error("STUPA_STAGE_ID must be an integer.");
  const url = new URL("/rest/v1/matches", supabaseUrl);
  url.searchParams.set("select", "starts_at");
  url.searchParams.set("stupa_stage_id", `eq.${stageId}`);
  url.searchParams.set("fantasy_gameweek_id", "not.is.null");
  url.searchParams.append("starts_at", `gte.${base.start}`);
  url.searchParams.append("starts_at", `lte.${new Date(now).toISOString()}`);
  url.searchParams.set("or", "(status.is.null,status.not.in.(cancelled,canceled,postponed,deleted))");
  url.searchParams.set("order", "starts_at.asc");
  url.searchParams.set("limit", "1");
  const response = await fetchImpl(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Could not check today's fixtures: HTTP ${response.status}`);
  const matches = await response.json();
  if (!Array.isArray(matches) || matches.some((row) => !Number.isFinite(Date.parse(row.starts_at)))) {
    throw new Error("Unexpected fixture response from Supabase.");
  }
  return resultsRefreshDecision({ now, eventName, schedule, matchStarts: matches.map((match) => match.starts_at) });
}

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const option = (name) => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing value for ${name}.`);
    return args[index + 1];
  };
  let environment = process.env;
  if (local) {
    // Ignore hosted shell credentials, matching the other local test commands.
    const content = await readFile(new URL("../.env.local", import.meta.url), "utf8");
    environment = {};
    for (const line of content.split(/\r?\n/)) {
      const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) environment[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    }
    const url = environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL;
    if (!url || new URL(url).origin !== "http://127.0.0.1:54321") {
      throw new Error("Local safety check failed: Supabase must be http://127.0.0.1:54321.");
    }
  }
  const at = option("--at");
  if (at && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(at)) throw new Error("--at must include Z or a UTC offset.");
  const decision = await checkResultsRefresh({
    now: at ? new Date(at) : new Date(),
    eventName: local ? "schedule" : process.env.GITHUB_EVENT_NAME,
    schedule: args.includes("--daily") ? DAILY_RESULTS_CRON : (local ? "7,22,37,52 * * * *" : process.env.RESULTS_CRON),
    supabaseUrl: environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    stageId: Number(option("--stage-id") ?? environment.STUPA_STAGE_ID ?? DEFAULT_STAGE_ID),
  });
  console.log(JSON.stringify(decision, null, 2));
  if (!local && process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT,
      `should_run=${decision.shouldRun}\nrefresh_schedule=${decision.refreshSchedule}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

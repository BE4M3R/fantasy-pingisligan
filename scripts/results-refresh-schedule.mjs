// Uses only Node built-ins so idle Actions runs can skip npm ci and STUPA.
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localDateTimeToUtcIso, nextStockholmMidnightUtcIso, STOCKHOLM_TIME_ZONE } from "./stockholm-time.mjs";
import { verifyStagingImportTarget } from "./verify-staging-import-target.mjs";

export const DAILY_RESULTS_CRON = "7 0 * * *";
export const MATCH_POLL_WINDOW_MS = 5 * 60 * 60 * 1000;
const DEFAULT_STAGE_ID = 5727;

export function parseRefreshCheckTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-](?:0\d|1[0-4])(?::?[0-5]\d)?)$/i.test(value)) {
    throw new Error("--at must include Z or a UTC offset.");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid refresh-check time.");
  return date;
}

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

export function resultsRefreshReport(decision, now) {
  const date = new Date(now);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: STOCKHOLM_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    checkedAtUtc: date.toISOString(),
    checkedAtStockholm: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
    shouldRun: decision.shouldRun,
    refreshSchedule: decision.refreshSchedule,
    reason: decision.reason,
  };
}

export function resultsRefreshDecision({ now, eventName, schedule, dispatchKind, matchStarts = [] }) {
  const window = stockholmDayWindow(now);
  const nowMs = new Date(now).getTime();
  // Use the triggering cron, not the runner's clock: a delayed daily job
  // must still run even if it starts well after midnight.
  if ((eventName === "workflow_dispatch" && [undefined, "", "full"].includes(dispatchKind)) || (eventName === "schedule" && schedule === DAILY_RESULTS_CRON)) {
    return { shouldRun: true, refreshSchedule: true, reason: eventName === "workflow_dispatch" ? "Manual refresh" : "Daily 00:07 refresh", ...window };
  }
  if (eventName !== "workflow_dispatch" || dispatchKind !== "poll") {
    throw new Error(`Unsupported results refresh event: ${eventName} (${schedule ?? dispatchKind ?? "unknown"}).`);
  }
  const previousDay = stockholmDayWindow(new Date(Date.parse(window.start) - 1));
  const starts = matchStarts.map(Date.parse);
  const withinMatchWindow = [previousDay, window].some((day) => {
    const dayStarts = starts.filter((start) =>
      start >= Date.parse(day.start) && start < Date.parse(day.end));
    return dayStarts.length > 0 && Math.min(...dayStarts) <= nowMs &&
      nowMs - Math.max(...dayStarts) < MATCH_POLL_WINDOW_MS;
  });
  return {
    shouldRun: withinMatchWindow,
    refreshSchedule: false,
    reason: withinMatchWindow ? "Between a playing day's first fixture start and five hours after its last fixture start" : "Outside fixture polling windows",
    ...window,
  };
}

export async function checkResultsRefresh({ now = new Date(), eventName, schedule, dispatchKind, supabaseUrl, serviceKey, stageId = DEFAULT_STAGE_ID, fetchImpl = fetch }) {
  const base = resultsRefreshDecision({ now, eventName, schedule, dispatchKind });
  if (base.shouldRun) return base;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase URL and service-role key are required for the match-day check.");
  if (!Number.isSafeInteger(stageId)) throw new Error("STUPA_STAGE_ID must be an integer.");
  const url = new URL("/rest/v1/rpc/results_refresh_window_active", supabaseUrl);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_at: new Date(now).toISOString(), p_stage_id: stageId }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Could not check the fixture window: HTTP ${response.status}`);
  const due = await response.json();
  if (typeof due !== "boolean") throw new Error("Unexpected fixture-window response from Supabase.");
  return { ...base, shouldRun: due, reason: due ? "Within a fixture polling window" : "Outside fixture polling windows" };
}

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const staging = args.includes("--staging");
  if (local && staging) throw new Error("Choose either --local or --staging.");
  const option = (name) => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing value for ${name}.`);
    return args[index + 1];
  };
  let environment = process.env;
  if (local || staging) {
    // Ignore shell credentials and load the selected target explicitly.
    const content = await readFile(new URL(staging ? "../.env.staging.local" : "../.env.local", import.meta.url), "utf8");
    environment = {};
    for (const line of content.split(/\r?\n/)) {
      const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) environment[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    }
    const url = environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL;
    if (local && (!url || new URL(url).origin !== "http://127.0.0.1:54321")) {
      throw new Error("Local safety check failed: Supabase must be http://127.0.0.1:54321.");
    }
    if (staging) verifyStagingImportTarget({
      supabaseUrl: environment.SUPABASE_URL,
      publicUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
      serviceKey: environment.SUPABASE_SERVICE_ROLE_KEY,
      projectRef: environment.STAGING_PROJECT_REF,
      appEnv: environment.APP_ENV,
      stageId: environment.STUPA_STAGE_ID,
    });
  }
  const at = option("--at") ?? (process.env.RESULTS_DISPATCH_KIND === "poll" ? process.env.RESULTS_SLOT_AT : undefined);
  const checkTime = at ? parseRefreshCheckTime(at) : new Date();
  const decision = await checkResultsRefresh({
    now: checkTime,
    eventName: local || staging ? (args.includes("--daily") ? "schedule" : "workflow_dispatch") : process.env.GITHUB_EVENT_NAME,
    schedule: args.includes("--daily") ? DAILY_RESULTS_CRON : process.env.RESULTS_CRON,
    dispatchKind: local || staging ? "poll" : process.env.RESULTS_DISPATCH_KIND,
    supabaseUrl: environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    stageId: Number(option("--stage-id") ?? environment.STUPA_STAGE_ID ?? DEFAULT_STAGE_ID),
  });
  console.log(JSON.stringify(resultsRefreshReport(decision, checkTime), null, 2));
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

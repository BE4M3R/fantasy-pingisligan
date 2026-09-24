import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyStagingImportTarget } from "./verify-staging-import-target.mjs";

const stageId = 5727;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function required(promise, description) {
  const result = await promise;
  if (result.error) {
    const detail = result.error.message || result.error.details || result.error.code || "unknown Supabase error";
    throw new Error(`${description} (HTTP ${result.status ?? "unknown"}): ${detail}`);
  }
  return result;
}

export async function readStagingRefreshStatus(supabase, checkedAt = new Date().toISOString()) {
  const [fixtures, completed, overdue, transferLock] = await Promise.all([
    required(supabase.from("matches").select("id", { count: "exact", head: true }).eq("stupa_stage_id", stageId), "Could not count real fixtures"),
    required(supabase.from("fantasy_gameweeks")
      .select("id, name, unlock_at, data_refreshed_at")
      .eq("stupa_stage_id", stageId).not("data_refreshed_at", "is", null)
      .order("unlock_at", { ascending: false }).limit(1).maybeSingle(), "Could not read the last completed real gameweek"),
    required(supabase.from("fantasy_gameweeks")
      .select("id, name, unlock_at")
      .eq("stupa_stage_id", stageId).is("data_refreshed_at", null).lt("unlock_at", checkedAt)
      .order("unlock_at", { ascending: true }).limit(1).maybeSingle(), "Could not check pending real gameweeks"),
    required(supabase.rpc("current_transfer_lock"), "Could not check transfers"),
  ]);

  let counts = null;
  if (completed.data) {
    const gameweekId = completed.data.id;
    const [matches, snapshots, scoredTeams] = await Promise.all([
      required(supabase.from("matches").select("id").eq("fantasy_gameweek_id", gameweekId), "Could not read gameweek fixtures"),
      required(supabase.from("fantasy_team_gameweek_snapshots").select("fantasy_team_id", { count: "exact", head: true }).eq("fantasy_gameweek_id", gameweekId), "Could not count locked squads"),
      required(supabase.from("fantasy_team_gameweek_points").select("fantasy_team_id", { count: "exact", head: true }).eq("fantasy_gameweek_id", gameweekId), "Could not count scored teams"),
    ]);
    const submatches = matches.data.length
      ? await required(supabase.from("stupa_submatches").select("stupa_submatch_id").in("match_id", matches.data.map((match) => match.id)), "Could not read imported results")
      : { data: [] };
    const playerResults = submatches.data.length
      ? await required(supabase.from("player_submatch_results").select("id", { count: "exact", head: true })
        .in("stupa_submatch_id", submatches.data.map((match) => match.stupa_submatch_id)), "Could not count player results")
      : { count: 0 };
    counts = {
      matches: matches.data.length,
      submatches: submatches.data.length,
      playerResults: playerResults.count,
      snapshots: snapshots.count,
      scoredTeams: scoredTeams.count,
    };
  }

  const lock = Array.isArray(transferLock.data) ? transferLock.data[0] : transferLock.data;
  let lockStageId = null;
  if (lock?.gameweek_id) {
    const gameweek = await required(supabase.from("fantasy_gameweeks")
      .select("stupa_stage_id").eq("id", lock.gameweek_id).maybeSingle(), "Could not identify the gameweek locking transfers");
    lockStageId = gameweek.data?.stupa_stage_id ?? null;
  }

  return {
    fixtureCount: fixtures.count,
    completed: completed.data,
    overdue: overdue.data,
    counts,
    lock,
    lockStageId,
  };
}

function printStatus(status) {
  console.log(`Real STUPA stage ${stageId}: ${status.fixtureCount ?? 0} imported fixtures.`);
  if (status.completed) {
    console.log(`Last completed: ${status.completed.name} (unlocked ${status.completed.unlock_at}; refreshed ${status.completed.data_refreshed_at}).`);
    console.log(`Its fixtures: ${status.counts.matches}; result matches: ${status.counts.submatches}; player results: ${status.counts.playerResults}.`);
    console.log(`Locked squads: ${status.counts.snapshots}; scored teams: ${status.counts.scoredTeams}.`);
  } else {
    console.log("No real gameweek has completed yet.");
  }
  if (status.overdue) console.log(`Pending after unlock: ${status.overdue.name} (${status.overdue.unlock_at}).`);
  if (status.lock?.is_locked) {
    console.log(`Transfers locked by ${status.lock.gameweek_name} (stage ${status.lockStageId ?? "unknown"}; refreshing: ${status.lock.is_refreshing}).`);
  } else {
    console.log("Transfers are open.");
  }

  const issues = [];
  if (!status.fixtureCount) issues.push("No real fixtures are imported.");
  if (status.overdue) issues.push("An unlocked real gameweek still needs results and scoring; run npm run refresh:staging again.");
  if (status.completed && !status.counts.matches) issues.push("The last completed real gameweek has no imported fixtures.");
  if (status.counts && status.counts.snapshots !== status.counts.scoredTeams) issues.push("The last completed gameweek has a different number of locked squads and scored teams.");
  if (status.lock?.is_refreshing && status.lockStageId !== stageId) issues.push("A non-real gameweek is keeping transfers closed; finish or clean up its test lifecycle.");
  if (issues.length) throw new Error(issues.join(" "));
  console.log("Real staging results and scoring status: OK.");
}

async function main() {
  verifyStagingImportTarget({
    supabaseUrl,
    publicUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey,
    projectRef: process.env.STAGING_PROJECT_REF,
    appEnv: process.env.APP_ENV,
    stageId: process.env.STUPA_STAGE_ID,
  });
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  printStatus(await readStagingRefreshStatus(supabase));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

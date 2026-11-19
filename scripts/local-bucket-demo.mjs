import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { assertTarget, readEnvironment } from "./environment.mjs";
import { persistSchedule } from "./import-stupa-schedule.mjs";
import { nextStockholmMidnightUtcIso } from "./stockholm-time.mjs";

// Deliberately separate from the populated lifecycle demo; no accounts,
// selections, existing fixtures or gameweeks are modified by this scenario.
const stageId = -900006;
const manifest = new URL("../test-results/bucket-migration-demo.json", import.meta.url);
const action = process.argv[2];
assert(["prepare", "verify"].includes(action) && process.argv.length === 3,
  "Usage: node scripts/local-bucket-demo.mjs prepare|verify (local only)");
const env = await readEnvironment(new URL("../.env.local", import.meta.url));
const url = assertTarget(env, "local");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }
async function protectedCounts() {
  return Promise.all(["profiles","fantasy_teams","fantasy_team_players","fantasy_team_gameweek_snapshots"].map(async table=>{
    const result=await db.from(table).select("*",{head:true,count:"exact"});checked(result);return [table,result.count];
  }));
}
if (action === "prepare") {
  const existing = checked(await db.from("fantasy_gameweeks").select("id").eq("stupa_stage_id", stageId));
  assert.equal(existing.length, 0, "Bucket migration demo already exists; use verify instead.");
  const clubs = checked(await db.from("clubs").select("id, name").order("name").limit(2));
  assert.equal(clubs.length, 2, "Two existing local clubs are required.");
  const first = new Date(Date.now() + 21 * 86400_000);
  first.setUTCHours(17, 0, 0, 0);
  const starts = [0, 0, 8, 7, 7];
  const matches = starts.map((day, index) => ({
    id: -906001 - index, round_id: index < 3 ? -907006 : -907007,
    round: { name: `[TEST] Bucket migration GW${index < 3 ? 6 : 7}`, order: index < 3 ? 6 : 7 },
    start_time: new Date(+first + day * 86400_000).toISOString(),
    end_time: new Date(+first + day * 86400_000 + 3 * 3600_000).toISOString(),
    status: "NOT_STARTED",
    participants: clubs.map((club, side) => ({ order: side + 1, participant_name: club.name, participant_id: -908001 - side })),
  }));
  // Set up legacy fixture data explicitly, as the existing lifecycle harness
  // does. This works before or after applying the schema migration; only
  // verify invokes the new application policy. Never bypass an initialized
  // policy or replace a populated stage to manufacture the old state.
  const legacyWeeks=[6,7].map(order=>{
    const fixtures=matches.filter(m=>m.round.order===order);
    const startsAt=fixtures.map(m=>m.start_time).sort()[0];
    const endsAt=fixtures.map(m=>m.end_time).sort().at(-1);
    return {id:randomUUID(),stupa_stage_id:stageId,stupa_round_id:order===6?-907006:-907007,
      round_order:order,name:`[TEST] Bucket migration GW${order}`,first_match_starts_at:startsAt,last_match_ends_at:endsAt,
      lock_at:new Date(Date.parse(startsAt)-2*3600_000).toISOString(),unlock_at:nextStockholmMidnightUtcIso(endsAt)};
  });
  checked(await db.from("fantasy_gameweeks").insert(legacyWeeks));
  try {
    checked(await db.from("matches").insert(matches.map(m=>({
      stupa_match_id:m.id,profixio_id:`stupa:${m.id}`,stupa_stage_id:stageId,stupa_round_id:m.round_id,
      fantasy_gameweek_id:legacyWeeks.find(w=>w.stupa_round_id===m.round_id).id,
      home_club_id:clubs[0].id,away_club_id:clubs[1].id,home_team_name:clubs[0].name,away_team_name:clubs[1].name,
      home_team_stupa_participant_id:-908001,away_team_stupa_participant_id:-908002,
      starts_at:m.start_time,ends_at:m.end_time,status:"not_started",
    }))));
  } catch(error) {
    checked(await db.from("fantasy_gameweeks").delete().in("id",legacyWeeks.map(w=>w.id)));
    throw error;
  }
  const before = checked(await db.from("matches").select("id, stupa_match_id, fantasy_gameweek_id").eq("stupa_stage_id", stageId));
  const weeks = checked(await db.from("fantasy_gameweeks").select("id, round_order").eq("stupa_stage_id", stageId));
  assert.equal(before.find(m => m.stupa_match_id === -906003).fantasy_gameweek_id, weeks.find(w => w.round_order === 6).id);
  await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
  await writeFile(manifest, JSON.stringify({ stageId, matches, before, weeks }, null, 2));
  console.log("Prepared local pre-migration fixture -906003 in GW6; its kickoff falls in GW7. Existing accounts and squads preserved.");
} else {
  const saved = JSON.parse(await readFile(manifest, "utf8"));
  assert.equal(saved.stageId, stageId);
  const countsBefore=await protectedCounts();
  await persistSchedule(db, saved.matches, stageId);
  const after = checked(await db.from("matches").select("id, stupa_match_id, fantasy_gameweek_id").eq("stupa_stage_id", stageId));
  const moved = after.find(m => m.stupa_match_id === -906003);
  assert.equal(moved.id, saved.before.find(m => m.stupa_match_id === -906003).id);
  assert.equal(moved.fantasy_gameweek_id, saved.weeks.find(w => w.round_order === 7).id);
  const lifecycle=checked(await db.from("fantasy_gameweeks").select("round_order, unlock_at").eq("stupa_stage_id",stageId).order("round_order"));
  assert.equal(Date.parse(lifecycle[0].unlock_at),Date.parse(nextStockholmMidnightUtcIso(saved.matches[0].end_time)));
  assert.equal(Date.parse(lifecycle[1].unlock_at),Date.parse(nextStockholmMidnightUtcIso(saved.matches[2].end_time)));
  await persistSchedule(db, saved.matches, stageId);
  assert.deepEqual(checked(await db.from("matches").select("id, stupa_match_id, fantasy_gameweek_id").eq("stupa_stage_id", stageId)).sort((a,b) => a.stupa_match_id-b.stupa_match_id), after.sort((a,b) => a.stupa_match_id-b.stupa_match_id));
  assert.deepEqual(await protectedCounts(),countsBefore,"Accounts, squads and existing snapshots must be preserved");
  console.log("Verified local migration: fixture -906003 moved GW6 → GW7, retained its ID, and repeated import was idempotent.");
  console.log(`Preserved local counts: ${JSON.stringify(countsBefore)}`);
  await writeFile(manifest,JSON.stringify({...saved,verification:{verified_at:new Date().toISOString(),fixture:moved.stupa_match_id,
    fixture_id:moved.id,source_gameweek:6,destination_gameweek:7,lifecycle,protected_counts:countsBefore}},null,2));
}

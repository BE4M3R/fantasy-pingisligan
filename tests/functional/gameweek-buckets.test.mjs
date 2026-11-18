import assert from "node:assert/strict";
import test from "node:test";
import { randomInt } from "node:crypto";
import { persistSchedule } from "../../scripts/import-stupa-schedule.mjs";
import { completeOldestUnlockedGameweek } from "../../scripts/complete-gameweek-refresh.mjs";
import { addMatch, addResult, checked, cleanupFixture, createFixture, complete, lock, save, squad } from "./fixture.mjs";

const later = (at, days) => new Date(Date.parse(at) + days * 86400_000).toISOString();
function source(f, first = "2032-09-07T16:00:00Z") {
  const base = randomInt(100000000, 1000000000);
  return [0,0,8,7,7].map((days,index) => ({
    id: base+index, round_id: f.weeks[index<3?0:1].stupa_round_id,
    round: {name:f.weeks[index<3?0:1].name,order:index<3?1:2},
    start_time:later(first,days),end_time:new Date(Date.parse(later(first,days))+3*3600_000).toISOString(),status:"NOT_STARTED",
    participants:[{order:1,participant_id:101,participant_name:f.clubs[0].name},{order:2,participant_id:102,participant_name:f.clubs[1].name}],
  }));
}
const stage = f => f.weeks[0].stupa_stage_id;
const rows = async f => checked(await f.admin.from("matches").select("*").eq("stupa_stage_id",stage(f)).order("stupa_match_id"),"Read bucket fixtures");
const weeks = async f => checked(await f.admin.from("fantasy_gameweeks").select("*").eq("stupa_stage_id",stage(f)).order("round_order"),"Read bucket weeks");
const importSource = (f,matches) => persistSchedule(f.admin,matches,stage(f));
const rescore = async f => checked(await f.admin.rpc("score_gameweek_refresh",{p_stage_id:stage(f),p_gameweek_ids:[]}),"Drain durable scores");

test("schedule initializes midpoint assignments, preserves IDs/boundaries, and tolerates later anchor-count ties",async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    const matches=source(f); await importSource(f,matches);
    const original=await rows(f), initial=await weeks(f);
    assert.equal(original.find(m=>m.stupa_match_id===matches[2].id).fantasy_gameweek_id,f.weeks[1].id);
    assert.equal(original.filter(m=>m.fantasy_gameweek_id===f.weeks[0].id).length,2);
    const moved=matches.map((m,i)=>i===0?{...m,start_time:later(m.start_time,7),end_time:later(m.end_time,7)}:m);
    await importSource(f,moved); await importSource(f,moved);
    const after=await rows(f), final=await weeks(f);
    assert.deepEqual(after.map(m=>m.id),original.map(m=>m.id));
    assert.equal(after.find(m=>m.stupa_match_id===matches[0].id).fantasy_gameweek_id,f.weeks[1].id);
    for(let i=0;i<2;i++) for(const key of ["anchor_at","anchor_week","bucket_starts_at","bucket_ends_at","bucket_initialized_at"])
      assert.equal(final[i][key],initial[i][key],key);
  } finally {await cleanupFixture(f);}
});

for(const locked of [[],[0],[1],[0,1]]) test(`unfinished reassignment works with locked weeks ${locked.join(",") || "none"} and preserves selections`,async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    await save(f,squad([f.players[0],f.players[2],f.players[4],f.players[6],f.players[1],f.players[3]]));
    const matches=source(f); await importSource(f,matches);
    for(const i of locked) await lock(f,f.weeks[i]);
    const before=checked(await f.admin.from("fantasy_team_gameweek_players").select("*").order("fantasy_gameweek_id").order("lineup_order"),"Read selections");
    const original=await weeks(f);
    await importSource(f,matches.map((m,i)=>i===0?{...m,start_time:later(m.start_time,7),end_time:later(m.end_time,7)}:m));
    assert.equal((await rows(f)).find(m=>m.stupa_match_id===matches[0].id).fantasy_gameweek_id,f.weeks[1].id);
    assert.deepEqual(checked(await f.admin.from("fantasy_team_gameweek_players").select("*").order("fantasy_gameweek_id").order("lineup_order"),"Read preserved selections"),before);
    const after=await weeks(f); for(const i of locked) assert.equal(after[i].lock_at,original[i].lock_at);
  }finally{await cleanupFixture(f);}
});

for(const finished of [0,1]) test(`finished ${finished===0?"source":"destination"} rejects a move atomically`,async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    const matches=source(f);await importSource(f,matches);
    checked(await f.admin.from("matches").update({status:"scored"}).eq("fantasy_gameweek_id",f.weeks[finished].id),"Resolve fixtures");
    await complete(f,f.weeks[finished]);
    const before=await rows(f), lifecycle=await weeks(f);
    await assert.rejects(importSource(f,matches.map((m,i)=>i===0?{...m,start_time:later(m.start_time,7),end_time:later(m.end_time,7)}:m)),/Protected fixture reassignment/);
    assert.deepEqual(await rows(f),before);assert.deepEqual(await weeks(f),lifecycle);
  }finally{await cleanupFixture(f);}
});

test("moving a postponed fixture out permits source completion without waiting for the destination",async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    const first=new Date(Date.now()-35*86400_000);first.setUTCHours(16,0,0,0);
    const matches=source(f,first.toISOString()).map(m=>({...m,status:"SCORED"}));
    await importSource(f,matches);
    const old=(await weeks(f))[0];
    const changed=matches.map((m,i)=>i===0?{...m,status:"NOT_STARTED",start_time:later(m.start_time,42),end_time:later(m.end_time,42)}:m);
    await importSource(f,changed);await rescore(f);
    const completed=await completeOldestUnlockedGameweek(f.admin,new Date().toISOString(),{stageId:stage(f),gameweekId:f.weeks[0].id});
    assert.equal(completed.id,f.weeks[0].id);
    const current=await weeks(f);assert.ok(current[0].data_refreshed_at);assert.equal(current[1].data_refreshed_at,null);
    assert.equal(current[0].lock_at,old.lock_at);
    assert.equal((await rows(f)).find(m=>m.stupa_match_id===matches[0].id).fantasy_gameweek_id,f.weeks[1].id);
  }finally{await cleanupFixture(f);}
});

test("undated postponements and cancelled fixtures retain identity and do not block empty-week completion",async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    const matches=source(f);await importSource(f,matches);
    const before=await rows(f);
    const changed=matches.map((m,i)=>i<2?{...m,status:i===0?"POSTPONED":"CANCELLED",start_time:null,end_time:null}:m);
    await importSource(f,changed);
    const after=await rows(f);for(let i=0;i<2;i++) {assert.equal(after[i].id,before[i].id);assert.equal(after[i].fantasy_gameweek_id,f.weeks[0].id);}
    await rescore(f);await complete(f,f.weeks[0]);
    assert.ok((await weeks(f))[0].data_refreshed_at);
    await assert.rejects(importSource(f,matches.map((m,i)=>i<2?{...m,start_time:later(m.start_time,7),end_time:later(m.end_time,7)}:m)),/Protected fixture reassignment/);
  }finally{await cleanupFixture(f);}
});

test("full-stage reimports of finished fixtures keep membership and completion while allowing same-period corrections",async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    const matches=source(f).map(m=>({...m,status:"SCORED"}));await importSource(f,matches);
    await complete(f,f.weeks[0]);
    const original=(await weeks(f))[0];
    await importSource(f,matches);
    await importSource(f,matches.map((m,i)=>i<2?{...m,start_time:later(m.start_time,1),end_time:later(m.end_time,1)}:m));
    const current=(await weeks(f))[0];
    for(const key of ["lock_at","unlock_at","data_refreshed_at","first_match_starts_at","last_match_ends_at"])
      assert.equal(current[key],original[key]);
    assert.equal((await rows(f)).find(m=>m.stupa_match_id===matches[0].id).fantasy_gameweek_id,f.weeks[0].id);
  }finally{await cleanupFixture(f);}
});

test("ambiguous initialization leaves existing rows untouched, including club writes",async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    const before=await weeks(f), matches=source(f);
    const ambiguous=[matches[0],matches[2],...matches.slice(3)];
    await assert.rejects(importSource(f,ambiguous),/Ambiguous anchor/);
    assert.deepEqual(await weeks(f),before);assert.deepEqual(await rows(f),[]);
  }finally{await cleanupFixture(f);}
});

test("durable rescoring removes source points, credits destination snapshots and survives a failed retry",async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    checked(await save(f,squad([f.players[0],f.players[2],f.players[4],f.players[6],f.players[1],f.players[3]])),"Save scoring squad");
    const matches=source(f).map(m=>({...m,status:"SCORED",winner:101}));await importSource(f,matches);
    await lock(f,f.weeks[0]);await lock(f,f.weeks[1]);
    const original=(await rows(f)).find(m=>m.stupa_match_id===matches[0].id);
    await addResult(f,{match:original,homeId:101,awayId:102},{home:[f.players[0]],away:[f.players[2]]});
    await rescore(f);
    const scores=async()=>checked(await f.admin.from("fantasy_team_gameweek_points").select("fantasy_gameweek_id,points").eq("fantasy_team_id",f.teamId),"Read scores");
    assert.equal((await scores()).find(w=>w.fantasy_gameweek_id===f.weeks[0].id).points,23);
    await importSource(f,matches.map((m,i)=>i===0?{...m,start_time:later(m.start_time,7),end_time:later(m.end_time,7)}:m));
    assert.ok((await f.admin.rpc("score_gameweek_refresh",{p_stage_id:stage(f),p_gameweek_ids:["invalid-uuid"]})).error);
    assert.equal(await rescore(f),2,"both weeks remain durably queued after the failed attempt");
    const after=await scores();
    assert.equal(after.find(w=>w.fantasy_gameweek_id===f.weeks[0].id).points,0);
    assert.equal(after.find(w=>w.fantasy_gameweek_id===f.weeks[1].id).points,23);
    assert.equal(await rescore(f),0,"successful scoring acknowledges work exactly once");
    const moved=(await rows(f)).find(m=>m.id===original.id);
    const cancelled=matches.map((m,i)=>i===0?{...m,status:"CANCELLED",start_time:moved.starts_at,end_time:moved.ends_at}:m);
    await importSource(f,cancelled);await rescore(f);
    assert.equal((await scores()).find(w=>w.fantasy_gameweek_id===f.weeks[1].id).points,0);
    assert.deepEqual(checked(await f.admin.from("player_match_stats").select("player_id").eq("match_id",original.id),"Cancelled appearances"),[]);
  }finally{await cleanupFixture(f);}
});

test("GW5 history and scores survive cutover initialization and full-stage scoring",async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    checked(await save(f,squad([f.players[0],f.players[2],f.players[4],f.players[6],f.players[1],f.players[3]])),"Save historical squad");
    await lock(f);
    const game=await addMatch(f);await addResult(f,game,{home:[f.players[0]],away:[f.players[2]]});
    await complete(f);
    for(let i=0;i<2;i++) {
      checked(await f.admin.from("fantasy_gameweeks").update({stupa_stage_id:5727,round_order:i+5}).eq("id",f.weeks[i].id),"Prepare historical stage");
      f.weeks[i].stupa_stage_id=5727;f.weeks[i].round_order=i+5;
    }
    const id=randomInt(100000000,1000000000);
    checked(await f.admin.from("matches").update({stupa_match_id:id,stupa_stage_id:5727}).eq("id",game.match.id),"Identify legacy fixture");
    const before=(await weeks(f))[0], fixtureBefore=(await rows(f)).find(m=>m.id===game.match.id);
    const scoreBefore=checked(await f.admin.from("fantasy_team_gameweek_points").select("*").eq("fantasy_gameweek_id",f.weeks[0].id),"Read historical score");
    const sourceMatches=source(f).filter((_,i)=>i===0||i>=3).map((m,i)=>({...m,id:i===0?id:m.id,round:{...m.round,order:i===0?5:6}}));
    await importSource(f,sourceMatches);await rescore(f);
    const after=(await weeks(f))[0];for(const key of ["lock_at","unlock_at","data_refreshed_at","first_match_starts_at","last_match_ends_at"]) assert.equal(after[key],before[key]);
    assert.deepEqual((await rows(f)).find(m=>m.id===game.match.id),fixtureBefore);
    assert.deepEqual(checked(await f.admin.from("fantasy_team_gameweek_points").select("*").eq("fantasy_gameweek_id",f.weeks[0].id),"Read protected score"),scoreBefore);
    assert.equal(checked(await f.admin.rpc("calculate_fantasy_gameweek_points",{target_gameweek_id:f.weeks[0].id}),"Protected historical scoring"),0);
    await assert.rejects(importSource(f,sourceMatches.map((m,i)=>i===0?{...m,start_time:later(m.start_time,14),end_time:later(m.end_time,14)}:m)),/historical protection|Protected fixture/);
  }finally{await cleanupFixture(f);}
});

test("concurrent schedule movement and completion cannot both commit stale source membership",async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    const first=new Date(Date.now()-35*86400_000);first.setUTCHours(16,0,0,0);
    const matches=source(f,first.toISOString()).map(m=>({...m,status:"SCORED"}));
    await importSource(f,matches);await rescore(f);
    const refreshedAt=new Date().toISOString();
    const moved=matches.map((m,i)=>i===0?{...m,start_time:later(m.start_time,7),end_time:later(m.end_time,7)}:m);
    const outcomes=await Promise.allSettled([
      importSource(f,moved),
      f.admin.rpc("complete_gameweek_refresh",{p_gameweek_id:f.weeks[0].id,p_refreshed_at:refreshedAt}).then(r=>{assert.equal(checked(r,"Concurrent completion"),true);}),
    ]);
    assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1,JSON.stringify(outcomes));
    const current=await weeks(f), membership=(await rows(f)).find(m=>m.stupa_match_id===matches[0].id).fantasy_gameweek_id;
    if(current[0].data_refreshed_at) assert.equal(membership,f.weeks[0].id);
    else assert.equal(membership,f.weeks[1].id);
  }finally{await cleanupFixture(f);}
});

test("an older unfinished week does not prevent a later ready week completing or release the global transfer lock",async()=>{
  const f=await createFixture({gameweeks:2});
  try {
    const first=new Date(Date.now()-35*86400_000);first.setUTCHours(16,0,0,0);
    const matches=source(f,first.toISOString()).map((m,i)=>({...m,status:i<2?"NOT_STARTED":"SCORED"}));
    await importSource(f,matches);await rescore(f);
    const result=await completeOldestUnlockedGameweek(f.admin,new Date().toISOString(),{stageId:stage(f)});
    assert.equal(result.id,f.weeks[1].id);
    const current=await weeks(f);assert.equal(current[0].data_refreshed_at,null);assert.ok(current[1].data_refreshed_at);
    assert.equal(checked(await f.user.rpc("current_transfer_lock"),"Read overlapping lock")[0].is_locked,true);
  }finally{await cleanupFixture(f);}
});

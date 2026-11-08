import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { checked, cleanupFixture, complete, createFixture, lock, save, squad } from "./fixture.mjs";

test("only opted-in Gameweeks appear as prize competitions; excluded rounds retain Fantasy standings", async () => {
  const f = await createFixture({ gameweeks: 5, competitions: true, prizeGameweeks: false });
  const anon = createClient(f.url, f.anonKey, { auth: { persistSession: false } });
  const path = `${f.id}/excluded-prize.png`;
  const readCards = async () => checked(await f.user.rpc("get_homepage_competitions"), "Carousel");
  try {
    checked(await f.admin.from("homepage_banners").insert({ gameweek_id: f.weeks[0].id,
      content_ready: true, title: "Excluded prize", prize_image_path: path, prize_image_alt: "Private prize" }), "Prepare optional prize");
    checked(await f.admin.storage.from("announcement-artwork").upload(path,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"), { contentType: "image/png" }), "Upload prize");
    assert.deepEqual((await readCards()).map(r => r.kind), ["season"]);
    assert.deepEqual(checked(await anon.rpc("competition_gameweek_routes"), "No implicit competitions"), []);
    const selectedIds = [f.weeks[0].id, f.weeks[2].id, f.weeks[3].id, f.weeks[4].id];
    checked(await f.admin.from("fantasy_gameweeks").update({ weekly_smash_enabled: true }).in("id", selectedIds), "Opt in prize rounds");
    assert.deepEqual((await readCards()).map(r => r.gameweek_number), [1, 3, 4, null]);
    // Match the schedule importer's ordinary upsert without an editorial flag.
    const schedule = { ...f.weeks[0] };
    delete schedule.weekly_smash_enabled;
    checked(await f.admin.from("fantasy_gameweeks").upsert(schedule, { onConflict: "stupa_round_id" }), "Refresh schedule");
    assert.equal(checked(await f.admin.from("fantasy_gameweeks").select("weekly_smash_enabled").eq("id", f.weeks[0].id).single(), "Preserved choice").weekly_smash_enabled, true);
    await f.user.from("fantasy_gameweeks").update({ weekly_smash_enabled: false }).eq("id", f.weeks[0].id);
    assert.equal(checked(await f.admin.from("fantasy_gameweeks").select("weekly_smash_enabled").eq("id", f.weeks[0].id).single(), "Ordinary users cannot choose prize rounds").weekly_smash_enabled, true);
    checked(await f.admin.from("fantasy_gameweeks").update({ weekly_smash_enabled: false }).eq("id", f.weeks[0].id), "Exclude current round");
    assert.deepEqual((await readCards()).map(r => r.gameweek_number), [3, 4, null]);
    for (const client of [anon, f.user]) {
      assert.deepEqual(checked(await client.rpc("get_public_competition", { p_gameweek_id: f.weeks[0].id }), "Excluded page"), []);
      assert.deepEqual(checked(await client.from("homepage_banners").select("title").eq("gameweek_id", f.weeks[0].id), "Excluded prize private"), []);
      assert.ok((await client.storage.from("announcement-artwork").createSignedUrl(path, 60)).error);
      assert.equal((await client.rpc("get_competition_standings", { p_gameweek_id: f.weeks[0].id })).error?.code, "42501");
    }
    checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save Fantasy entry");
    await lock(f);
    checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - 60000).toISOString() }).eq("id", f.weeks[0].id), "Reach kickoff");
    await complete(f);
    assert.equal(checked(await f.user.rpc("homepage_gameweek_states"), "All Fantasy rounds").length, 5);
    assert.equal(checked(await f.user.rpc("get_gameweek_leaderboard", { p_gameweek_id: f.weeks[0].id }), "Excluded prize still has Fantasy standings").total, 1);
    assert.ok(!(await readCards()).some(r => r.gameweek_number === 1));
    checked(await f.admin.from("fantasy_gameweeks").update({ weekly_smash_enabled: true }).eq("id", f.weeks[0].id), "Opt in past round explicitly");
    assert.equal((await readCards())[0].gameweek_number, 1);
    assert.equal((await readCards())[0].title, "Excluded prize");
    assert.equal((await readCards())[0].state, "previous");
  } finally {
    checked(await f.admin.storage.from("announcement-artwork").remove([path]), "Remove prize art");
    await cleanupFixture(f);
  }
});

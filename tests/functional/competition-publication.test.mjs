import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "./fixture.mjs";

test("unlaunched competitions deny direct table, RPC and artwork access to visitors and managers", async () => {
  const f = await createFixture({ prizeGameweeks: true });
  const seasonId = randomUUID();
  const ruleId = randomUUID();
  const path = `${f.id}/unpublished-prize.png`;
  const anon = createClient(f.url, f.anonKey, { auth: { persistSession: false } });
  try {
    checked(await f.admin.from("competition_rules").insert({ id: ruleId, kind: "gameweek", version: 1,
      title: "Private draft", body: "DRAFT_SECRET" }), "Prepare private rules");
    checked(await f.admin.from("homepage_banners").insert([
      { gameweek_id: f.weeks[0].id, content_ready: true, title: "UNLAUNCHED_SECRET", cta_label: "Secret prize",
        prize_image_path: path, prize_image_alt: "Secret artwork", prize_product_url: "https://example.invalid/secret" },
      { id: seasonId, kind: "season", published: true, title: "UNLAUNCHED_SEASON" },
    ], { defaultToNull: false }), "Prepare ready unpublished competitions");
    checked(await f.admin.storage.from("announcement-artwork").upload(path,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"), { contentType: "image/png" }), "Upload private artwork");
    for (const client of [anon, f.user]) {
      assert.equal(checked(await client.rpc("competitions_enabled"), "Read launch state"), false);
      assert.deepEqual(checked(await client.from("homepage_banners").select("id, title, prize_product_url"), "No direct prizes"), []);
      assert.deepEqual(checked(await client.from("competition_rules").select("id, body"), "No direct rules"), []);
      for (const rpc of ["competition_gameweek_routes", "get_public_competition_promotions"])
        assert.deepEqual(checked(await client.rpc(rpc), rpc), []);
      for (const id of [f.weeks[0].id, null])
        assert.deepEqual(checked(await client.rpc("get_public_competition", { p_gameweek_id: id }), "No competition detail"), []);
      assert.equal((await client.rpc("get_competition_standings", { p_gameweek_id: f.weeks[0].id })).error?.code, "42501");
      assert.ok((await client.storage.from("announcement-artwork").createSignedUrl(path, 60)).error);
      assert.ok((await client.storage.from("announcement-artwork").download(path)).error);
      assert.ok((await client.from("competition_publication").update({ enabled: true }).eq("id", true)).error);
    }
    assert.deepEqual(checked(await f.user.rpc("get_homepage_competitions"), "No carousel cards"), []);
    assert.deepEqual(checked(await anon.rpc("homepage_gameweek_states"), "Anonymous lifecycle stays hidden"), []);
    const weeks = checked(await f.user.rpc("homepage_gameweek_states"), "Signed-in round selector");
    assert.equal(weeks.length, 1);
    assert.equal(weeks[0].gameweek_id, f.weeks[0].id);
    assert.ok((await anon.rpc("get_gameweek_leaderboard", { p_gameweek_id: f.weeks[0].id })).error);
    const weekly = (extra = {}) => f.user.rpc("get_gameweek_leaderboard", { p_gameweek_id: f.weeks[0].id, ...extra });
    assert.equal(checked(await weekly(), "Pre-kickoff league").visible, false);
    checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save ordinary Fantasy squad");
    await lock(f);
    const game = await addMatch(f);
    await addResult(f, game, { home: [f.players[0]], away: [f.players[2]] });
    checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - 60000).toISOString() }).eq("id", f.weeks[0].id), "Reach kickoff");
    await complete(f);
    const standings = checked(await weekly(), "Scored league before competition launch");
    assert.equal(standings.visible, true);
    assert.equal(standings.rows[0].team_name, `Functional ${f.id}`);
    const points = checked(await f.admin.from("fantasy_team_gameweek_points").select("points").eq("fantasy_team_id", f.teamId).single(), "Canonical Fantasy score").points;
    assert.equal(standings.rows[0].total_points, points);
    assert.equal(checked(await weekly({ p_search: "FUNCTIONAL" }), "Weekly search").total, 1);
    assert.deepEqual(checked(await weekly({ p_offset: 1, p_limit: 1 }), "Weekly pagination").rows, []);
    assert.equal((await anon.rpc("get_competition_standings", { p_gameweek_id: f.weeks[0].id })).error?.code, "42501");
    checked(await f.admin.from("competition_publication").update({ enabled: true }).eq("id", true), "Explicit local launch");
    assert.equal(checked(await anon.rpc("get_public_competition", { p_gameweek_id: f.weeks[0].id }), "Ready preview")[0].title, "UNLAUNCHED_SECRET");
    assert.deepEqual(checked(await anon.from("competition_rules").select("id, body"), "Draft still hidden after launch"), []);
    assert.ok(checked(await anon.storage.from("announcement-artwork").createSignedUrl(path, 60), "Explicitly launched artwork").signedUrl);
    checked(await f.admin.from("competition_publication").update({ enabled: false }).eq("id", true), "Disable feature again");
    assert.deepEqual(checked(await anon.rpc("get_public_competition", { p_gameweek_id: f.weeks[0].id }), "Immediate withdrawal"), []);
  } finally {
    checked(await f.admin.storage.from("announcement-artwork").remove([path]), "Remove private art");
    checked(await f.admin.from("homepage_banners").delete().eq("id", seasonId), "Remove season");
    checked(await f.admin.from("competition_rules").delete().eq("id", ruleId), "Remove private draft");
    await cleanupFixture(f);
  }
});

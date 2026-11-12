import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { addMatch, addResult, checked, cleanupFixture, complete, createFixture, lock, save, squad } from "./fixture.mjs";

const anonymous = (f) => createClient(f.url, f.anonKey, { auth: { persistSession: false } });
const read = async (client, id, extra = {}) => checked(await client.rpc("get_competition_standings", { p_gameweek_id: id, ...extra }), "Read public standings");
const review = async (f) => checked(await f.admin.rpc("get_weekly_competition_review", { p_gameweek_id: f.weeks[0].id }), "Review provisional result");
const selection = (f) => squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]]);
const score = async (f) => checked(await f.admin.rpc("calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }), "Score using Fantasy");

test("numbered routes reject ambiguity and public promotions select only revealed current content", async () => {
  const f = await createFixture({ gameweeks: 3, competitions: true, seasonCompetitions: true });
  const seasonId = randomUUID();
  try {
    const anon = anonymous(f);
    checked(await f.admin.from("homepage_banners").insert([
      { gameweek_id: f.weeks[0].id, content_ready: true, sponsor: "Current partner", prize_title: "A bag", prize_value_sek: 500 },
      { gameweek_id: f.weeks[1].id, content_ready: true, sponsor: "Future secret", prize_value_sek: 9999 },
      { id: seasonId, kind: "season", published: true, publish_at: new Date(Date.now() + 3600000).toISOString(),
        sponsor: "Season secret", prize_value_sek: 16000 },
    ], { defaultToNull: false }), "Prepare discovery content");
    let promotions = checked(await anon.rpc("get_public_competition_promotions"), "Public promotions");
    assert.equal(promotions.length, 2);
    assert.equal(promotions[0].sponsor, "Current partner");
    assert.equal(promotions[0].prize_title, null, "Prize headlines are confined to detail pages");
    assert.equal(promotions[0].description, null);
    assert.equal(Number(promotions[0].prize_value_sek), 500);
    assert.equal(promotions[0].public_path, "/competitions/gameweek/1");
    assert.equal(promotions[1].sponsor, null);
    assert.equal(promotions[1].prize_value_sek, null);
    assert.equal(promotions[1].public_path, "/competitions/season");
    assert.ok(!JSON.stringify(promotions).includes("secret"));
    assert.ok(!("rules_markdown" in promotions[0]));
    assert.ok(!("user_id" in promotions[0]));
    checked(await f.admin.from("homepage_banners").update({ publish_at: new Date(Date.now() - 60000).toISOString() }).eq("id", seasonId), "Publish season independently");
    promotions = checked(await anon.rpc("get_public_competition_promotions"), "Revealed season promotion");
    assert.equal(promotions[1].sponsor, "Season secret");
    checked(await f.admin.from("fantasy_gameweeks").update({ round_order: 1 }).eq("id", f.weeks[1].id), "Repeated Gameweek number");
    const routes = checked(await anon.rpc("competition_gameweek_routes").eq("gameweek_number", 1), "Ambiguous routes");
    assert.equal(routes.length, 2);
    assert.ok(routes.every((r) => r.public_path === `/competitions/gameweek/${r.gameweek_id}`));
    assert.ok((await anon.rpc("get_weekly_competition_review", { p_gameweek_id: f.weeks[0].id })).error);
  } finally {
    checked(await f.admin.from("homepage_banners").delete().eq("id", seasonId), "Remove discovery season");
    await cleanupFixture(f);
  }
});

test("public competition metadata and artwork share the existing reveal gate without granting writes or announcement access", async () => {
  const f = await createFixture({ gameweeks: 2, competitions: true, seasonCompetitions: true });
  const anon = anonymous(f);
  const paths = [0, 1, 2].map((i) => `${f.id}/competition-${i}.png`);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const seasonId = randomUUID();
  try {
    checked(await f.admin.from("homepage_banners").insert([
      ...f.weeks.map((w, i) => ({ gameweek_id: w.id, content_ready: true, title: `Competition ${i}`,
        sponsor: `Sponsor ${i}`, image_path: paths[i], image_alt: `Logo ${i}`,
        prize_image_path: paths[i], prize_image_alt: `Prize ${i}`, prize_description: `Prize description ${i}`,
        prize_product_url: `https://example.com/product-${i}`, details_markdown: `Details ${i}` })),
      { id: seasonId, kind: "season", published: false, title: "Hidden season", prize_image_path: paths[2], prize_image_alt: "Hidden prize" },
    ], { defaultToNull: false }), "Prepare content");
    for (const path of paths) checked(await f.admin.storage.from("announcement-artwork").upload(path, png, { contentType: "image/png" }), "Upload prize");
    const detail = async (id) => checked(await anon.rpc("get_public_competition", { p_gameweek_id: id }), "Read public detail");
    assert.equal((await detail(f.weeks[0].id))[0].sponsor, "Sponsor 0");
    assert.equal((await detail(f.weeks[0].id))[0].rules_markdown, null, "Terms remain unpublished until approved");
    for (const id of [f.weeks[1].id, null]) {
      const hidden = (await detail(id))[0];
      assert.equal(hidden.content_available, false);
      for (const key of ["sponsor", "image_path", "prize_image_path", "prize_description", "rules_markdown", "prize_product_url", "details_markdown"])
        assert.equal(hidden[key], null, key);
    }
    for (const prize_product_url of ["http://example.com/bag", "//example.com/bag", "javascript:alert(1)", "https://user:password@example.com/bag", "https://example.com/a b"]) {
      assert.ok((await f.admin.from("homepage_banners").update({ prize_product_url }).eq("gameweek_id", f.weeks[0].id)).error, `Reject ${prize_product_url}`);
    }
    const productUrl = "https://shop.example.com/products/bag?variant=red#details";
    checked(await f.admin.from("homepage_banners").update({ prize_product_url: productUrl }).eq("gameweek_id", f.weeks[0].id), "Set valid product URL");
    assert.equal((await detail(f.weeks[0].id))[0].prize_product_url, productUrl);
    assert.deepEqual(await detail(randomUUID()), []);
    assert.deepEqual(checked(await anon.from("homepage_banners").select("title, sponsor, prize_image_path")
      .eq("gameweek_id", f.weeks[1].id), "Direct future lookup"), []);
    assert.ok(checked(await anon.storage.from("announcement-artwork").createSignedUrl(paths[0], 60), "Public prize signing").signedUrl);
    assert.ok((await anon.storage.from("announcement-artwork").createSignedUrl(paths[1], 60)).error);
    assert.ok((await anon.storage.from("announcement-artwork").download(paths[2])).error);
    assert.ok((await anon.storage.from("announcement-artwork").upload(`${f.id}/forbidden.png`, png)).error);
    for (const client of [anon, f.user]) {
      assert.ok((await client.from("homepage_banners").insert({ gameweek_id: f.weeks[0].id })).error);
      assert.ok((await client.rpc("get_weekly_competition_review", { p_gameweek_id: f.weeks[0].id })).error);
      assert.ok(!(await client.from("fantasy_team_gameweek_snapshots").select("*")).data?.length);
    }
    assert.ok((await anon.from("announcements").select("*")).error);
    checked(await f.admin.from("homepage_banners").update({ published: true }).eq("id", seasonId), "Reveal season");
    assert.equal((await detail(null))[0].title, "Hidden season");
    assert.ok(checked(await anon.storage.from("announcement-artwork").createSignedUrl(paths[2], 60), "Public season prize").signedUrl);
    checked(await f.admin.from("homepage_banners").update({ content_ready: false }).eq("gameweek_id", f.weeks[0].id), "Withdraw weekly content");
    assert.equal((await detail(f.weeks[0].id))[0].content_available, false);
    assert.ok((await anon.storage.from("announcement-artwork").createSignedUrl(paths[0], 60)).error);
  } finally {
    checked(await f.admin.storage.from("announcement-artwork").remove(paths), "Remove prizes");
    checked(await f.admin.from("homepage_banners").delete().eq("id", seasonId), "Remove season");
    await cleanupFixture(f);
  }
});

for (const chip of [null, "triple_captain", "bench_boost", "wildcard"]) {
  test(`weekly totals and raw substituted captain match canonical scoring with ${chip ?? "normal captain"}`, async () => {
    const f = await createFixture({ competitions: true });
    try {
      const anon = anonymous(f);
      checked(await save(f, selection(f), chip), "Save chip squad");
      assert.equal((await read(anon, f.weeks[0].id)).visible, false);
      await lock(f);
      const game = await addMatch(f);
      // Two absent starters: absent captain at slot 0 pairs with playing bench
      // slot 4, using exactly the scorer's ordered substitution behavior.
      await addResult(f, game, { home: [f.players[1]], away: [f.players[2]] });
      checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - 60000).toISOString() })
        .eq("id", f.weeks[0].id), "Reach kickoff");
      let result = await read(anon, f.weeks[0].id);
      assert.equal(result.missing_scores, 1);
      assert.deepEqual(result.rows, []);
      assert.equal((await review(f)).status, "incomplete_scores");
      if (chip !== "wildcard") checked(await f.admin.from("fantasy_team_gameweek_snapshots").update({ transfer_penalty_points: -4 })
        .eq("fantasy_team_id", f.teamId), "Stored transfer deduction");
      await score(f);
      result = await read(anon, f.weeks[0].id);
      const persisted = checked(await f.admin.from("fantasy_team_gameweek_points").select("points").eq("fantasy_team_id", f.teamId).single(), "Stored total");
      assert.equal(result.rows[0].points, persisted.points);
      assert.deepEqual(Object.keys(result.rows[0]).sort(), ["points", "rank", "team_name"]);
      const raw = checked(await f.admin.from("fantasy_team_gameweek_players").select("fantasy_points")
        .eq("fantasy_team_id", f.teamId).eq("player_id", f.players[1].id).single(), "Replacement raw score").fantasy_points;
      const inspected = await review(f);
      assert.equal(inspected.prize_candidates[0].captain_raw_points, raw);
      assert.equal(inspected.award_enabled, false);
      assert.equal(inspected.status, "awaiting_refresh");
      await complete(f);
      const completed = await review(f);
      assert.equal(completed.status, "provisional_leader", JSON.stringify(completed));
      checked(await f.admin.from("matches").update({ status: "postponed" }).eq("id", game.match.id), "Outstanding fixture despite completion");
      assert.equal((await read(anon, f.weeks[0].id)).outstanding_fixtures, 1);
      assert.equal((await review(f)).status, "awaiting_results");
      checked(await f.admin.from("matches").update({ status: "scored" }).eq("id", game.match.id), "Restore fixture");
      checked(await f.admin.from("fantasy_team_gameweek_points").delete().eq("fantasy_team_id", f.teamId), "Missing is not zero");
      assert.equal((await review(f)).status, "incomplete_scores");
      await score(f);
      // Corrections use the ordinary scorer, with no competition-specific update.
      await addResult(f, game, { home: [f.players[1]], away: [f.players[3]], order: 2 });
      await score(f);
      assert.notEqual((await read(anon, f.weeks[0].id)).rows[0].points, persisted.points);
      checked(await f.admin.from("fantasy_team_gameweek_players").delete().eq("fantasy_team_id", f.teamId).eq("player_id", f.players[6].id), "Invalid incomplete snapshot");
      assert.deepEqual((await read(anon, f.weeks[0].id)).rows, []);
    } finally { await cleanupFixture(f); }
  });
}

test("competition ranks compare raw captain and historical season points, retaining a manual draw for complete ties", async () => {
  const f = await createFixture({ gameweeks: 3, competitions: true, seasonCompetitions: true });
  const users = [];
  try {
    checked(await save(f, selection(f), "triple_captain"), "Save Triple Captain");
    // Additional managers use the same real save/snapshot/scoring path.
    const extra = [];
    const competitors = [];
    for (const name of ["Higher captain", "Identical higher captain"]) {
      const email = `${randomUUID()}@example.invalid`;
      const user = checked(await f.admin.auth.admin.createUser({ email, password: f.password, email_confirm: true }), "Create competitor").user;
      users.push(user.id);
      const teamId = randomUUID();
      checked(await f.admin.from("fantasy_teams").insert({ id: teamId, user_id: user.id, name,
        onboarding_completed: true, created_at: new Date(Date.now() - 3600000).toISOString() }), "Create competitor team");
      const client = anonymous(f);
      checked(await client.auth.signInWithPassword({ email, password: f.password }), "Sign in competitor");
      checked(await client.rpc("save_my_complete_fantasy_team", { p_gameweek_id: f.weeks[0].id,
        p_squad: squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]], { captain: 1 }), p_chip: null }), "Save competitor");
      extra.push(teamId);
      competitors.push(client);
    }
    assert.equal(checked(await f.user.rpc("get_gameweek_leaderboard", { p_gameweek_id: f.weeks[0].id }), "Pre-match weekly league").visible, false);
    await lock(f);
    const game = await addMatch(f);
    await addResult(f, game, { home: [f.players[0]], away: [f.players[2]] });
    checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - 60000).toISOString() }).eq("id", f.weeks[0].id), "Start fixtures");
    await complete(f);
    // Isolate the agreed 80/12/Triple versus 80/16/Normal example. Persisted
    // totals remain authoritative; no client-side recalculation is permitted.
    checked(await f.admin.from("fantasy_team_gameweek_points").update({ points: 80 }).eq("fantasy_gameweek_id", f.weeks[0].id), "Equal net scores");
    checked(await f.admin.from("fantasy_team_gameweek_players").update({ fantasy_points: 12 }).eq("player_id", f.players[0].id), "Raw twelve");
    checked(await f.admin.from("fantasy_team_gameweek_players").update({ fantasy_points: 16 }).eq("player_id", f.players[2].id), "Raw sixteen");
    let inspected = await review(f);
    assert.equal(inspected.status, "draw_required");
    assert.equal(inspected.tied_leaders.length, 3);
    assert.deepEqual(new Set(inspected.prize_candidates.map((c) => c.team_id)), new Set(extra));
    assert.ok(inspected.prize_candidates.every((c) => c.captain_raw_points === 16));
    const anon = anonymous(f);
    const first = await read(anon, f.weeks[0].id, { p_limit: 1 });
    const second = await read(anon, f.weeks[0].id, { p_limit: 1, p_offset: 1 });
    assert.equal(first.total_count, 3);
    assert.equal(first.rows[0].rank, 1);
    assert.equal(second.rows[0].rank, 1);
    assert.notEqual(first.rows[0].team_name, second.rows[0].team_name);
    const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
    checked(await f.admin.from("fantasy_gameweeks").update({ lock_at: ago(60),
      first_match_starts_at: ago(50), last_match_ends_at: ago(40), unlock_at: ago(30),
      data_refreshed_at: ago(29) }).eq("id", f.weeks[1].id), "Prepare earlier season scores");
    checked(await f.admin.from("fantasy_team_gameweek_points").insert([
      { fantasy_team_id: extra[0], fantasy_gameweek_id: f.weeks[1].id, points: 50 },
      { fantasy_team_id: extra[1], fantasy_gameweek_id: f.weeks[1].id, points: 40 },
      { fantasy_team_id: f.teamId, fantasy_gameweek_id: f.weeks[1].id, points: 1000 },
    ]), "Set season totals before the competition");
    inspected = await review(f);
    assert.equal(inspected.status, "provisional_leader");
    assert.equal(inspected.draw_required, false);
    assert.equal(inspected.prize_candidates[0].team_id, extra[0]);
    assert.equal(inspected.prize_candidates[0].season_points, 130);
    assert.deepEqual((await read(anon, f.weeks[0].id)).rows.map((r) => r.rank), [1, 2, 3]);
    // A subsequently completed round must not change this competition's order.
    checked(await f.admin.from("fantasy_gameweeks").update({ lock_at: ago(5),
      first_match_starts_at: ago(4), last_match_ends_at: ago(3), unlock_at: ago(2),
      data_refreshed_at: ago(1) }).eq("id", f.weeks[2].id), "Prepare later season scores");
    checked(await f.admin.from("fantasy_team_gameweek_points").insert({ fantasy_team_id: extra[1],
      fantasy_gameweek_id: f.weeks[2].id, points: 10000 }), "Later season leader");
    assert.equal((await review(f)).prize_candidates[0].team_id, extra[0]);
    assert.equal((await read(anon, f.weeks[0].id, { p_search: "IDENTICAL" })).rows[0].rank, 2);
    checked(await f.admin.from("fantasy_team_gameweek_points").update({ points: 50 })
      .eq("fantasy_team_id", extra[1]).eq("fantasy_gameweek_id", f.weeks[1].id), "Equal historical season totals");
    assert.equal((await review(f)).draw_required, true, "Complete ties require a manual draw");
    checked(await f.admin.from("fantasy_team_gameweek_points").update({ points: 79 }).eq("fantasy_team_id", extra[1])
      .eq("fantasy_gameweek_id", f.weeks[0].id), "One fewer net point");
    inspected = await review(f);
    assert.equal(inspected.status, "provisional_leader");
    assert.equal(inspected.prize_candidates[0].team_id, extra[0]);
    assert.deepEqual((await read(anon, f.weeks[0].id)).rows.map((r) => r.rank), [1, 2, 3]);
    checked(await f.admin.from("fantasy_teams").update({ name: "Renamed after deadline" }).eq("id", f.teamId), "Rename team");
    assert.ok(!(await read(anon, f.weeks[0].id)).rows.some((r) => r.team_name === "Renamed after deadline"));
    const searched = await read(anon, f.weeks[0].id, { p_search: "IDENTICAL", p_limit: 1 });
    assert.equal(searched.total_count, 1);
    assert.equal(searched.rows[0].rank, 3, "Search preserves the overall Gameweek rank");
    assert.deepEqual(Object.keys(searched.rows[0]).sort(), ["points", "rank", "team_name"]);
    assert.equal((await read(anon, f.weeks[0].id, { p_search: "%" })).total_count, 0, "Search treats wildcard characters literally");
    assert.equal((await read(anon, f.weeks[0].id, { p_search: "Renamed after deadline" })).total_count, 0, "Search uses the locked team name");
    assert.ok((await anon.rpc("get_gameweek_leaderboard", { p_gameweek_id: f.weeks[0].id })).error);
    const own = checked(await competitors[1].rpc("get_gameweek_leaderboard", {
      p_gameweek_id: f.weeks[0].id, p_limit: 1, p_include_own: true,
    }), "Weekly league own position");
    assert.equal(own.total, 3);
    assert.equal(own.rows.length, 2);
    assert.ok(own.rows.some((row) => row.user_id === users[1] && row.rank === 3));
    assert.ok(own.rows.every((row) => !('email' in row)));
    const leagueSearch = checked(await f.user.rpc("get_gameweek_leaderboard", {
      p_gameweek_id: f.weeks[0].id, p_search: "IDENTICAL", p_limit: 1,
    }), "Search weekly league");
    assert.equal(leagueSearch.total, 1);
    assert.equal(leagueSearch.rows[0].rank, 3);
    assert.equal(leagueSearch.rows[0].total_points, 79);
    assert.equal(leagueSearch.rows[0].user_id, users[1]);
    const season = await read(anon, null);
    assert.deepEqual(Object.keys(season.rows[0]).sort(), ["points", "rank", "team_name"]);
    assert.equal(checked(await f.admin.from("announcements").select("id"), "No automatic awards").length, 0);
  } finally {
    for (const id of users) checked(await f.admin.auth.admin.deleteUser(id), "Remove competitor");
    await cleanupFixture(f);
  }
});

test("genuine zero and negative stored scores participate; an invalid captain does not", async () => {
  const f = await createFixture({ competitions: true });
  try {
    checked(await save(f, selection(f)), "Save zero-score squad");
    await lock(f);
    checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - 60000).toISOString() }).eq("id", f.weeks[0].id), "Start round");
    await complete(f);
    const anon = anonymous(f);
    assert.equal((await read(anon, f.weeks[0].id)).rows[0].points, 0);
    checked(await f.admin.from("fantasy_team_gameweek_snapshots").update({ transfer_penalty_points: -4 }).eq("fantasy_team_id", f.teamId), "Negative total");
    await score(f);
    assert.equal((await read(anon, f.weeks[0].id)).rows[0].points, -4);
    checked(await f.admin.from("fantasy_team_gameweek_players").update({ is_captain: false }).eq("fantasy_team_id", f.teamId), "Invalid captain");
    assert.deepEqual((await read(anon, f.weeks[0].id)).rows, []);
  } finally { await cleanupFixture(f); }
});

test("effective captain uses the paired second bench player and accepts any valid saved lineup order", async () => {
  const f = await createFixture({ competitions: true });
  try {
    const selected = squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]], { captain: 1 });
    // The existing save accepts interleaved positions. Competition validity
    // must not invent an additional starter/bench index restriction.
    checked(await save(f, [selected[0], selected[4], selected[1], selected[5], selected[2], selected[3]], "triple_captain"), "Save ordered squad");
    await lock(f);
    const game = await addMatch(f);
    await addResult(f, game, { home: [f.players[1]], away: [f.players[3]] });
    checked(await f.admin.from("fantasy_gameweeks").update({ first_match_starts_at: new Date(Date.now() - 60000).toISOString() }).eq("id", f.weeks[0].id), "Reach kickoff");
    await score(f);
    const raw = checked(await f.admin.from("fantasy_team_gameweek_players").select("fantasy_points")
      .eq("fantasy_team_id", f.teamId).eq("player_id", f.players[3].id).single(), "Second bench raw").fantasy_points;
    assert.equal(raw, 1);
    assert.equal((await review(f)).prize_candidates[0].captain_raw_points, raw);
    assert.equal((await read(anonymous(f), f.weeks[0].id)).rows.length, 1);
  } finally { await cleanupFixture(f); }
});

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { checked, cleanupFixture, complete, createFixture, lock, save, squad } from "./fixture.mjs";
import { preserveLockedGameweekBoundaries } from "../../scripts/import-stupa-schedule.mjs";

const minutes = (n) => new Date(Date.now() + n * 60_000).toISOString();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const cards = async (f) => checked(await f.user.rpc("get_homepage_competitions"), "Read competitions");

// Exercise ordinary direct table/RPC/storage requests as well as Fantasy's
// actual lock, scoring and completion helpers on a disposable database.
test("all Gameweek cards share lifecycle, public teasers and secure prize/artwork gates", async () => {
  const f = await createFixture({ gameweeks: 5, competitions: true, seasonCompetitions: true });
  const ids = Array.from({ length: 6 }, () => randomUUID());
  const paths = ids.map((id) => `${f.id}/${id}.png`);
  const anon = createClient(f.url, f.anonKey, { auth: { persistSession: false } });
  try {
    checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save squad");
    checked(await f.admin.from("homepage_banners").insert([
      ...f.weeks.map((w, i) => ({ id: ids[i], gameweek_id: w.id, content_ready: true,
        title: i ? `Secret ${i}` : null, sponsor: `Partner ${i}`, prize_title: `Prize ${i}`,
        image_path: paths[i], image_alt: `Logo ${i}` })),
      { id: ids[5], kind: "season", published: true, publish_at: minutes(60), title: "Secret season",
        sponsor: "Season partner", image_path: paths[5], image_alt: "Season logo" },
    ], { defaultToNull: false }), "Prepare all content without weekly publication dates");
    for (const path of paths) checked(await f.admin.storage.from("announcement-artwork").upload(path, png, { contentType: "image/png" }), "Upload artwork");
    const signing = (index) => f.user.storage.from("announcement-artwork").createSignedUrl(paths[index], 60);
    let rows = await cards(f);
    assert.deepEqual(rows.map((r) => r.gameweek_number), [1, 2, 3, 4, 5, null]);
    assert.deepEqual(rows.map((r) => r.state), ["open", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
    assert.equal(rows[0].is_current, true);
    assert.equal(rows[0].title, "Gameweek 1 competition");
    assert.equal(rows[0].sponsor, "Partner 0");
    assert.equal(rows[0].description, "Prize 0");
    const readTeasers = (client = anon) => client.rpc("get_public_gameweek_teasers");
    const teasers = checked(await readTeasers(), "Read safe public teasers");
    assert.equal(teasers.length, 5);
    assert.ok(teasers.every((r) => Object.keys(r).sort().join() === "gameweek_id,teaser"));
    checked(await f.admin.from("homepage_banners").update({ teaser: "A public surprise awaits 👀", content_ready: false })
      .eq("id", ids[1]), "Edit future teaser independently of prize readiness");
    assert.equal((await cards(f))[1].cta_label, "A public surprise awaits 👀");
    assert.equal((await cards(f))[1].description, null, "A public teaser never reveals the prize headline");
    for (const client of [anon, f.user]) {
      assert.ok((await client.from("competition_publication").select("teaser")).error, "Teasers have moved off publication controls");
      assert.ok((await client.from("homepage_banners").update({ teaser: "Unauthorized edit" }).eq("id", ids[1])).error);
      assert.deepEqual(checked(await client.from("homepage_banners").select("teaser,prize_title").eq("id", ids[1]), "Future banner stays private"), []);
    }
    for (const teaser of [" ", "x".repeat(241)]) assert.ok((await f.admin.from("homepage_banners").update({ teaser }).eq("id", ids[1])).error);
    checked(await f.admin.from("homepage_banners").update({ content_ready: true }).eq("id", ids[1]), "Restore ready prize");
    checked(await f.admin.from("competition_publication").update({ enabled: false }).eq("gameweek_id", f.weeks[1].id), "Hide future competition");
    assert.ok(!checked(await readTeasers(), "Excluded teaser hidden").some((r) => r.gameweek_id === f.weeks[1].id));
    checked(await f.admin.from("competition_publication").update({ enabled: true }).eq("gameweek_id", f.weeks[1].id), "Restore future competition");
    checked(await f.admin.from("competition_publication").update({ enabled: false }).eq("id", "global"), "Hide all teasers");
    assert.deepEqual(checked(await readTeasers(), "Launch gate protects teaser projection"), []);
    checked(await f.admin.from("competition_publication").update({ enabled: true }).eq("id", "global"), "Restore publication");
    for (const r of rows.slice(1)) {
      assert.equal(r.sponsor, null);
      assert.equal(r.description, null);
      assert.equal(r.image_path, null);
      assert.equal(r.image_alt, null);
      assert.equal(r.cta_url, null);
      assert.ok(!r.title.includes("Secret"));
    }
    assert.ok((await anon.rpc("get_homepage_competitions")).error);
    assert.ok((await anon.from("homepage_banners").select("*")).error);
    assert.ok(checked(await signing(0), "Revealed image").signedUrl);
    assert.ok(checked(await anon.storage.from("announcement-artwork").createSignedUrl(paths[0], 60), "Public revealed artwork").signedUrl);
    for (let i = 1; i < paths.length; i++) {
      assert.deepEqual(checked(await f.user.from("homepage_banners").select("*").eq("id", ids[i]), "Direct secret lookup"), []);
      assert.ok((await signing(i)).error, "Future artwork cannot be signed");
      assert.ok((await f.user.storage.from("announcement-artwork").download(paths[i])).error, "Future artwork cannot be downloaded");
    }
    const duplicate = await f.admin.from("homepage_banners").insert({ gameweek_id: f.weeks[0].id });
    assert.ok(duplicate.error, "Only one optional content row per gameweek");
    assert.ok((await f.admin.from("homepage_banners").insert({ kind: "season" })).error);
    assert.ok((await f.user.from("homepage_banners").insert({ gameweek_id: f.weeks[0].id })).error);
    assert.ok((await f.user.from("homepage_banners").update({ content_ready: false }).eq("id", ids[0])).error);
    assert.ok((await f.user.from("homepage_banners").delete().eq("id", ids[0])).error);
    assert.equal((await cards(f))[0].sponsor, "Partner 0", "Users cannot change content");

    await lock(f);
    assert.equal((await cards(f))[0].state, "live");
    // Scheduled end has passed, but no successful results/scoring refresh yet.
    checked(await f.admin.from("fantasy_gameweeks").update({ unlock_at: minutes(-1) }).eq("id", f.weeks[0].id), "Reach refresh window");
    rows = await cards(f);
    assert.equal(rows[0].state, "refreshing");
    assert.equal(rows[0].is_current, true);
    assert.equal(rows[1].state, "upcoming");
    assert.ok((await signing(1)).error);
    await complete(f);
    rows = await cards(f);
    assert.deepEqual(rows.map((r) => r.gameweek_number), [1, 2, 3, 4, 5, null]);
    assert.equal(rows[0].state, "previous");
    assert.equal(rows[0].sponsor, "Partner 0", "History keeps original content");
    assert.equal(rows[1].state, "open");
    assert.equal(rows[1].is_current, true);
    assert.equal(rows[1].sponsor, "Partner 1");
    assert.equal(rows[1].cta_label, "A public surprise awaits 👀", "Lifecycle updates preserve teaser edits");
    assert.ok(checked(await signing(1), "Next reveal image").signedUrl);

    // Use the importer's boundary rule: future deadlines move, locked ones stay.
    const proposed = { ...f.weeks[4], lock_at: minutes(10) };
    const [moved] = preserveLockedGameweekBoundaries([proposed], f.weeks);
    checked(await f.admin.from("fantasy_gameweeks").update({ lock_at: moved.lock_at }).eq("id", moved.id), "Apply future schedule change");
    rows = await cards(f);
    assert.equal(rows.find((r) => r.is_current).gameweek_number, 5);
    assert.ok((await signing(1)).error, "Reordered future round returns to embargo");
    assert.ok(checked(await signing(4), "Rescheduled current artwork").signedUrl);

    checked(await f.admin.from("homepage_banners").update({ content_ready: false }).eq("id", ids[4]), "Withdraw weekly content");
    rows = await cards(f);
    assert.equal(rows.find((r) => r.is_current).title, "Gameweek 5 competition");
    assert.equal(rows.find((r) => r.is_current).sponsor, null);
    assert.ok((await signing(4)).error);
    checked(await f.admin.from("homepage_banners").update({ publish_at: minutes(-1) }).eq("id", ids[5]), "Reveal season independently");
    assert.equal((await cards(f)).at(-1).title, "Secret season");
    assert.ok(checked(await signing(5), "Season image").signedUrl);
    await lock(f, f.weeks[4]);
    assert.equal((await cards(f)).at(-1).sponsor, "Season partner", "Season survives weekly transfer changes");
    checked(await f.admin.from("homepage_banners").update({ expires_at: new Date().toISOString() }).eq("id", ids[5]), "Expire season");
    assert.equal((await cards(f)).at(-1).state, "upcoming");
    assert.ok((await signing(5)).error);
    assert.equal(checked(await f.user.from("announcement_user_state").select("*"), "Independent announcements").length, 0);
  } finally {
    checked(await f.admin.storage.from("announcement-artwork").remove(paths), "Remove artwork");
    checked(await f.admin.from("homepage_banners").delete().in("id", ids), "Remove content");
    await cleanupFixture(f);
  }
});

test("all fourteen default teasers work without banner rows, with retained history and a season-only fallback", async () => {
  const f = await createFixture({ gameweeks: 14, competitions: true, seasonCompetitions: true });
  try {
    let rows = await cards(f);
    assert.equal(rows.length, 15);
    const defaults = rows.slice(0, -1).map((r) => r.cta_label);
    assert.equal(new Set(defaults).size, 14);
    assert.ok(defaults.every((value) => typeof value === "string" && value.trim().length));
    assert.equal(rows[0].title, "Gameweek 1 competition");
    for (const week of f.weeks.slice(0, 5)) {
      checked(await f.admin.from("fantasy_gameweeks").update({ lock_at: minutes(-10), unlock_at: minutes(-1) }).eq("id", week.id), "Pass test deadline");
      await complete(f, week);
    }
    rows = await cards(f);
    assert.equal(rows.length, 15, "All historical and future cards stay browsable plus season");
    assert.ok(rows.slice(0, 5).every((r) => r.state === "previous" && !r.is_current));
    assert.equal(checked(await f.admin.from("homepage_banners").select("*"), "No generated content rows").length, 0);
    checked(await f.admin.from("fantasy_gameweeks").delete().in("id", f.weeks.map((w) => w.id)), "Remove this fixture's rounds");
    rows = await cards(f);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "season");
    assert.equal(rows[0].state, "upcoming");
  } finally { await cleanupFixture(f); }
});

test("overlapping pending gameweeks keep the next competition and its artwork locked until both refreshes complete", async () => {
  const f = await createFixture({ gameweeks: 3, competitions: true, seasonCompetitions: true });
  const id = randomUUID();
  const artwork = `${f.id}/next-competition.png`;
  const nextId = `gameweek:${f.weeks[2].id}`;
  try {
    checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save overlapping-round squad");
    checked(await f.admin.from("homepage_banners").insert({ id, gameweek_id: f.weeks[2].id,
      content_ready: true, sponsor: "Next competition partner", image_path: artwork, image_alt: "Next prize" }), "Prepare next competition");
    checked(await f.admin.storage.from("announcement-artwork").upload(artwork, png, { contentType: "image/png" }), "Upload next prize");
    await lock(f, f.weeks[0]);
    await lock(f, f.weeks[1]);
    checked(await f.admin.from("fantasy_gameweeks").update({ unlock_at: minutes(-1) })
      .in("id", f.weeks.slice(0, 2).map((w) => w.id)), "Both rounds await refresh");
    await complete(f, f.weeks[0]);

    assert.equal(checked(await f.user.rpc("current_transfer_lock"), "Remaining transfer lock")[0].is_locked, true);
    let rows = await cards(f);
    assert.equal(rows.find((r) => r.id === `gameweek:${f.weeks[0].id}`).state, "previous");
    assert.equal(rows.find((r) => r.is_current).id, `gameweek:${f.weeks[1].id}`);
    assert.equal(rows.find((r) => r.is_current).state, "refreshing");
    assert.equal(rows.find((r) => r.id === nextId).state, "upcoming");
    assert.equal(rows.find((r) => r.id === nextId).sponsor, null);
    assert.deepEqual(checked(await f.user.from("homepage_banners").select("*").eq("id", id), "Next competition remains private"), []);
    assert.ok((await f.user.storage.from("announcement-artwork").createSignedUrl(artwork, 60)).error);

    await complete(f, f.weeks[1]);
    assert.equal(checked(await f.user.rpc("current_transfer_lock"), "All locks cleared")[0].is_locked, false);
    rows = await cards(f);
    assert.equal(rows.find((r) => r.is_current).id, nextId);
    assert.equal(rows.find((r) => r.id === nextId).state, "open");
    assert.equal(rows.find((r) => r.id === nextId).sponsor, "Next competition partner");
    assert.ok(checked(await f.user.storage.from("announcement-artwork").createSignedUrl(artwork, 60), "Reveal next artwork").signedUrl);
  } finally {
    checked(await f.admin.storage.from("announcement-artwork").remove([artwork]), "Remove next prize");
    checked(await f.admin.from("homepage_banners").delete().eq("id", id), "Remove next competition");
    await cleanupFixture(f);
  }
});

test("weekly readiness overrides legacy publication dates while season uses its own publication controls", async () => {
  const f = await createFixture({ competitions: true, seasonCompetitions: true });
  const weeklyId = randomUUID();
  const seasonId = randomUUID();
  try {
    checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save publication-control squad");
    checked(await f.admin.from("homepage_banners").insert([
      { id: weeklyId, gameweek_id: f.weeks[0].id, content_ready: true, sponsor: "Weekly partner",
        published: false, publish_at: minutes(60), expires_at: minutes(120) },
      { id: seasonId, kind: "season", content_ready: false, published: true,
        publish_at: minutes(-1), sponsor: "Season partner" },
    ], { defaultToNull: false }), "Prepare independent content controls");
    assert.equal((await cards(f))[0].sponsor, "Weekly partner", "Weekly reveal ignores legacy published/future publication");
    assert.equal((await cards(f)).at(-1).sponsor, "Season partner", "Season publication ignores content_ready=false");

    checked(await f.admin.from("homepage_banners").update({ published: true,
      publish_at: minutes(-120), expires_at: minutes(-60) }).eq("id", weeklyId), "Expire legacy weekly dates");
    await lock(f);
    await complete(f);
    const completed = (await cards(f))[0];
    assert.equal(completed.state, "previous");
    assert.equal(completed.sponsor, "Weekly partner", "Legacy expiry cannot remove completed competition content");

    checked(await f.admin.from("homepage_banners").update({ content_ready: false,
      publish_at: minutes(-60), expires_at: null }).eq("id", weeklyId), "Withdraw weekly content despite published=true");
    assert.equal((await cards(f))[0].sponsor, null);
    assert.deepEqual(checked(await f.user.from("homepage_banners").select("*").eq("id", weeklyId), "Weekly ready flag guards direct reads"), []);
    checked(await f.admin.from("homepage_banners").update({ content_ready: true, published: false })
      .eq("id", seasonId), "Keep season draft despite content_ready=true");
    assert.equal((await cards(f)).at(-1).state, "upcoming");
    assert.equal((await cards(f)).at(-1).sponsor, null);
    assert.deepEqual(checked(await f.user.from("homepage_banners").select("*").eq("id", seasonId), "Season publication guards direct reads"), []);
  } finally {
    checked(await f.admin.from("homepage_banners").delete().in("id", [weeklyId, seasonId]), "Remove independent content controls");
    await cleanupFixture(f);
  }
});

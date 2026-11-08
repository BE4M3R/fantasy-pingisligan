import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { checked, cleanupFixture, createFixture } from "./fixture.mjs";

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

test("announcement publication, owner isolation, permanent dismissal, snooze and private artwork", async (t) => {
  const f = await createFixture();
  const ids = Array.from({ length: 6 }, () => randomUUID());
  const artwork = `${f.id}/prize.png`;
  let guestId;
  try {
    const rows = ids.map((id, index) => ({ id, title: `Announcement ${index}`, body: "A **safe** update.",
      published: true, popup_enabled: true, publish_at: ago(60 - index),
      priority: index === 1 ? "high" : "normal",
    }));
    rows[2].popup_until = ago(10);
    rows[3].popup_enabled = false;
    rows[4].publish_at = ago(-60);
    rows[4].image_path = artwork;
    rows[4].image_alt = "A prize";
    rows[5].published = false;
    checked(await f.admin.from("announcements").insert(rows), "Create announcements");
    const guest = checked(await f.admin.auth.admin.createUser({ email: `notice-${f.id}@example.invalid`, password: f.password, email_confirm: true }), "Create second reader");
    guestId = guest.user.id;
    const other = createClient(f.url, f.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    checked(await other.auth.signInWithPassword({ email: `notice-${f.id}@example.invalid`, password: f.password }), "Sign in second reader");
    const anon = createClient(f.url, f.anonKey, { auth: { persistSession: false } });

    await t.test("only published due content is readable, including expired inbox history", async () => {
      assert.ok((await anon.from("announcements").select("id")).error);
      assert.ok((await anon.rpc("get_my_announcement_summary")).error);
      const visible = checked(await f.user.from("announcements").select("id"), "Read due announcements");
      assert.deepEqual(visible.map((row) => row.id).sort(), ids.slice(0, 4).sort());
      for (const id of ids.slice(4)) {
        assert.deepEqual(checked(await f.user.from("announcements").select("*").eq("id", id), "Direct unpublished lookup"), []);
        assert.ok((await f.user.rpc("record_announcement_interaction", { p_announcement_id: id })).error);
      }
      const summary = checked(await f.user.rpc("get_my_announcement_summary"), "Read compact summary");
      assert.equal(summary.unread_count, 4);
      assert.deepEqual(summary.pending.map((item) => item.id), [ids[1], ids[0]]);
      assert.ok(summary.pending.every((item) => !Object.hasOwn(item, "body")));
      assert.ok((await f.user.from("announcements").insert({ title: "Injected", body: "No" })).error);
      assert.ok((await f.user.from("announcements").update({ published: true }).eq("id", ids[5])).error);
      assert.ok((await f.user.from("announcements").delete().eq("id", ids[0])).error);
    });

    await t.test("reading and dismissing differ; dismissal timestamps survive repeated calls and edits", async () => {
      checked(await f.user.rpc("record_announcement_interaction", { p_announcement_id: ids[0] }), "Read announcement");
      let summary = checked(await f.user.rpc("get_my_announcement_summary"), "Summary after read");
      assert.equal(summary.unread_count, 3);
      assert.ok(summary.pending.some((item) => item.id === ids[0]));
      checked(await f.user.rpc("record_announcement_interaction", { p_announcement_id: ids[0], p_dismiss: true }), "Dismiss announcement");
      const before = checked(await f.user.from("announcement_user_state").select("*").single(), "Read dismissal");
      assert.ok(before.dismissed_at);
      checked(await f.user.rpc("record_announcement_interaction", { p_announcement_id: ids[0], p_dismiss: true }), "Repeat dismissal");
      checked(await f.user.rpc("record_announcement_interaction", { p_announcement_id: ids[0], p_dismiss: false }), "Read dismissed announcement");
      assert.deepEqual(checked(await f.user.from("announcement_user_state").select("*").single(), "Read unchanged state"), before);
      checked(await f.admin.from("announcements").update({ title: "Edited", priority: "high" }).eq("id", ids[0]), "Edit dismissed item");
      summary = checked(await f.user.rpc("get_my_announcement_summary"), "Summary after edit");
      assert.deepEqual(summary.pending.map((item) => item.id), [ids[1]]);
      assert.equal(checked(await f.user.from("announcements").select("id").eq("id", ids[0]), "Dismissed history").length, 1);
      assert.ok((await f.user.from("announcement_user_state").update({ dismissed_at: null }).eq("announcement_id", ids[0])).error);
      assert.ok((await f.user.from("announcement_user_state").delete().eq("announcement_id", ids[0])).error);
    });

    await t.test("interaction and snooze state stay private and use a database-controlled 24 hours", async () => {
      assert.deepEqual(checked(await other.from("announcement_user_state").select("*"), "Other reader state"), []);
      assert.ok((await other.from("announcement_user_state").insert({ user_id: f.userId, announcement_id: ids[1] })).error);
      const start = Date.now();
      const until = checked(await f.user.rpc("snooze_announcements"), "Snooze Normal announcements");
      assert.ok(Date.parse(until) >= start + 86_400_000 - 1000);
      assert.ok(Date.parse(until) <= Date.now() + 86_400_000);
      const summary = checked(await f.user.rpc("get_my_announcement_summary"), "Snoozed summary");
      assert.equal(summary.snoozed_until, until);
      assert.equal(summary.unread_count, 3, "Skipping leaves unseen content unread");
      assert.ok(summary.pending.some((item) => item.priority === "high"));
      assert.deepEqual(checked(await other.from("announcement_user_preferences").select("*"), "Other reader preferences"), []);
      assert.equal(checked(await other.rpc("get_my_announcement_summary"), "Other reader summary").snoozed_until, null);
      assert.ok((await other.from("announcement_user_preferences").upsert({ user_id: f.userId, snoozed_until: ago(-1) })).error);
    });

    await t.test("artwork cannot leak before publication; expiry preserves access and withdrawal removes it", async () => {
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
      checked(await f.admin.storage.from("announcement-artwork").upload(artwork, png, { contentType: "image/png" }), "Upload private artwork");
      assert.ok((await f.user.storage.from("announcement-artwork").createSignedUrl(artwork, 60)).error);
      assert.ok((await f.user.storage.from("announcement-artwork").upload(`${f.id}/unauthorized.png`, png, { contentType: "image/png" })).error);
      const publicUrl = f.admin.storage.from("announcement-artwork").getPublicUrl(artwork).data.publicUrl;
      assert.equal((await fetch(publicUrl)).ok, false);
      checked(await f.admin.from("announcements").update({ publish_at: ago(30), popup_until: ago(1) }).eq("id", ids[4]), "Publish expired promotion");
      assert.ok(checked(await f.user.storage.from("announcement-artwork").createSignedUrl(artwork, 60), "Published history artwork").signedUrl);
      assert.ok((await anon.storage.from("announcement-artwork").createSignedUrl(artwork, 60)).error);
      checked(await f.admin.from("announcements").update({ published: false }).eq("id", ids[4]), "Withdraw publication");
      assert.ok((await f.user.storage.from("announcement-artwork").createSignedUrl(artwork, 60)).error);
    });
  } finally {
    checked(await f.admin.storage.from("announcement-artwork").remove([artwork]), "Remove announcement artwork");
    checked(await f.admin.from("announcements").delete().in("id", ids), "Remove announcements");
    if (guestId) checked(await f.admin.auth.admin.deleteUser(guestId), "Remove second reader");
    await cleanupFixture(f);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { checked, cleanupFixture, createFixture } from "./fixture.mjs";

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

test("account announcement preview protects drafts, scheduled content, artwork and interaction state", async () => {
  const f = await createFixture();
  const ids = Array.from({ length: 5 }, () => randomUUID());
  const artwork = `${f.id}/announcement-preview.png`;
  const otherEmail = `announcement-preview-${f.id}@example.invalid`;
  let otherId;
  try {
    otherId = checked(await f.admin.auth.admin.createUser({ email: otherEmail, password: f.password,
      email_confirm: true, user_metadata: { can_preview_announcements: true } }), "Create ordinary reader").user.id;
    const other = createClient(f.url, f.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    checked(await other.auth.signInWithPassword({ email: otherEmail, password: f.password }), "Sign in ordinary reader");
    const anon = createClient(f.url, f.anonKey, { auth: { persistSession: false } });
    checked(await f.admin.from("announcements").insert([
      { id: ids[0], title: "Published news", published: true },
      { id: ids[1], title: "Draft preview", published: false, image_path: artwork, image_alt: "Private preview artwork" },
      { id: ids[2], title: "Scheduled preview", published: true, publish_at: ago(-60) },
      { id: ids[3], title: "Expired draft popup", published: false, popup_until: ago(10) },
      { id: ids[4], title: "Inbox-only draft", published: false, popup_enabled: false },
    ].map((row) => ({ body: "Preview **content**.", popup_enabled: true, publish_at: ago(60), ...row }))), "Create announcement previews");
    checked(await f.admin.storage.from("announcement-artwork").upload(artwork,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
      { contentType: "image/png" }), "Upload preview artwork");

    assert.ok((await anon.rpc("can_preview_announcements")).error);
    assert.ok((await anon.from("announcements").select("*")).error);
    assert.ok((await anon.rpc("get_my_announcement_summary")).error);
    for (const client of [f.user, other]) {
      assert.equal(checked(await client.rpc("can_preview_announcements"), "Default-off permission"), false);
      assert.ok((await client.from("profiles").update({ can_preview_announcements: true }).eq("id", f.userId)).error);
    }
    checked(await f.user.auth.updateUser({ data: { can_preview_announcements: true } }), "Try self-grant through metadata");
    assert.equal(checked(await f.user.rpc("can_preview_announcements"), "Metadata cannot grant preview"), false);
    checked(await f.user.from("profiles").update({ display_name: "Announcement reviewer" }).eq("id", f.userId), "Ordinary profile edits still work");
    checked(await f.admin.from("profiles").update({ can_preview_competitions: true }).eq("id", otherId), "Independent competition preview");

    const assertOrdinary = async (client) => {
      assert.deepEqual(checked(await client.from("announcements").select("id"), "Ordinary visible news").map((a) => a.id), [ids[0]]);
      const summary = checked(await client.rpc("get_my_announcement_summary"), "Ordinary summary");
      assert.equal(summary.unread_count, 1);
      assert.deepEqual(summary.pending.map((a) => a.id), [ids[0]]);
      for (const id of ids.slice(1)) {
        assert.deepEqual(checked(await client.from("announcements").select("*").eq("id", id), "Hidden direct lookup"), []);
        assert.ok((await client.rpc("record_announcement_interaction", { p_announcement_id: id, p_dismiss: true })).error);
      }
      assert.ok((await client.storage.from("announcement-artwork").createSignedUrl(artwork, 60)).error);
      assert.ok((await client.storage.from("announcement-artwork").download(artwork)).error);
    };
    await assertOrdinary(f.user);
    await assertOrdinary(other);

    checked(await f.admin.from("profiles").update({ can_preview_announcements: true }).eq("id", f.userId), "Select preview account");
    assert.equal(checked(await f.user.rpc("can_preview_announcements"), "Preview enabled"), true);
    assert.equal(checked(await f.user.rpc("can_preview_competitions"), "Announcement permission is independent"), false);
    assert.deepEqual(checked(await f.user.from("announcements").select("id"), "Reviewer inbox").map((a) => a.id).sort(), [...ids].sort());
    let summary = checked(await f.user.rpc("get_my_announcement_summary"), "Reviewer popup candidates");
    assert.equal(summary.unread_count, 5);
    assert.deepEqual(summary.pending.map((a) => a.id).sort(), ids.slice(0, 3).sort());
    assert.ok(summary.pending.every((a) => !Object.hasOwn(a, "body")), "Summary remains compact");
    assert.ok(checked(await f.user.storage.from("announcement-artwork").createSignedUrl(artwork, 60), "Reviewer signed artwork").signedUrl);
    assert.ok(checked(await f.user.storage.from("announcement-artwork").download(artwork), "Reviewer artwork download"));
    assert.ok((await anon.storage.from("announcement-artwork").createSignedUrl(artwork, 60)).error);
    assert.ok((await anon.storage.from("announcement-artwork").download(artwork)).error);
    assert.ok((await anon.rpc("record_announcement_interaction", { p_announcement_id: ids[1] })).error);
    assert.ok((await f.user.from("announcements").update({ published: true }).eq("id", ids[1])).error);
    assert.ok((await f.user.from("announcements").insert({ title: "Injected", body: "No" })).error);
    assert.ok((await f.user.from("announcements").delete().eq("id", ids[1])).error);
    await assertOrdinary(other);

    checked(await f.user.rpc("record_announcement_interaction", { p_announcement_id: ids[1] }), "Read draft");
    checked(await f.user.rpc("record_announcement_interaction", { p_announcement_id: ids[2] }), "Read future announcement");
    checked(await f.user.rpc("record_announcement_interaction", { p_announcement_id: ids[1], p_dismiss: true }), "Dismiss draft");
    const dismissal = checked(await f.user.from("announcement_user_state").select("*").eq("announcement_id", ids[1]).single(), "Preview dismissal");
    assert.ok(dismissal.dismissed_at);
    summary = checked(await f.user.rpc("get_my_announcement_summary"), "Summary after preview interactions");
    assert.equal(summary.unread_count, 3);
    assert.deepEqual(summary.pending.map((a) => a.id).sort(), [ids[0], ids[2]].sort());
    assert.deepEqual(checked(await other.from("announcement_user_state").select("*"), "Preview interactions stay private"), []);

    checked(await f.admin.from("profiles").update({ can_preview_announcements: false }).eq("id", f.userId), "Revoke preview");
    await assertOrdinary(f.user);
    await assertOrdinary(other);

    checked(await f.admin.from("announcements").update({ published: true }).eq("id", ids[1]), "Publish reviewed draft");
    for (const client of [f.user, other]) {
      assert.deepEqual(checked(await client.from("announcements").select("id"), "Normal publication").map((a) => a.id).sort(), ids.slice(0, 2).sort());
      assert.ok(checked(await client.storage.from("announcement-artwork").createSignedUrl(artwork, 60), "Published artwork").signedUrl);
    }
    assert.equal(checked(await other.rpc("get_my_announcement_summary"), "Other reader sees newly published draft").unread_count, 2);
    assert.deepEqual(checked(await f.user.rpc("get_my_announcement_summary"), "Review dismissal survives publication").pending.map((a) => a.id), [ids[0]]);
    assert.deepEqual(checked(await f.user.from("announcement_user_state").select("*").eq("announcement_id", ids[1]).single(), "Preserved dismissal"), dismissal);
  } finally {
    checked(await f.admin.storage.from("announcement-artwork").remove([artwork]), "Remove preview artwork");
    checked(await f.admin.from("announcements").delete().in("id", ids), "Remove preview announcements");
    if (otherId) checked(await f.admin.auth.admin.deleteUser(otherId), "Remove ordinary reader");
    await cleanupFixture(f);
  }
});

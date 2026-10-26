import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { checked, cleanupFixture, createFixture, save, squad } from "../functional/fixture.mjs";

async function login(page, fixture) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("Password").fill(fixture.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

test("announcement sequence, snooze across devices, inbox and safe responsive layouts", async ({ page, browser }, testInfo) => {
  test.setTimeout(150_000);
  const f = await createFixture();
  const ids = Array.from({ length: 27 }, () => randomUUID());
  const pageErrors = [];
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("503 (Service Unavailable)")) consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const popup = page.getByRole("dialog", { name: "Announcement", exact: true });
  const inbox = page.getByRole("dialog", { name: "Announcements", exact: true });
  let secondDevice;
  const artwork = `${f.id}/sponsor.png`;
  const artworkVariants = [
    { path: `${f.id}/banner.png`, file: "branding/pingisligan-fantasy-wordmark.png", contentType: "image/png", label: "Landscape announcement banner", capture: "banner" },
    { path: `${f.id}/logo.jpg`, file: "club-logos/sbtf-eskilstuna.jpg", contentType: "image/jpeg", label: "White-backed sponsor logo", capture: "logo" },
  ];
  try {
    checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save announcement reader squad");
    checked(await f.admin.from("fantasy_teams").update({ onboarding_completed: false }).eq("id", f.teamId), "Prepare onboarding fixture");
    checked(await f.admin.storage.from("announcement-artwork").upload(artwork, await readFile(new URL("../../public/branding/pingisligan-fantasy-mark-transparent-v2.png", import.meta.url)), { contentType: "image/png" }), "Upload browser artwork");
    for (const variant of artworkVariants) {
      checked(await f.admin.storage.from("announcement-artwork").upload(variant.path, await readFile(new URL(`../../public/${variant.file}`, import.meta.url)), { contentType: variant.contentType }), "Upload artwork variant");
    }
    checked(await f.admin.from("announcements").insert([
      { id: ids[0], title: "New player statistics", priority: "normal", publish_at: ago(60) },
      { id: ids[1], title: "Important gameweek update", priority: "high", publish_at: ago(30) },
      { id: ids[2], title: "Your next sponsored gameweek", category: "sponsor", image_path: artwork, image_alt: "Fantasy Pingisligan sponsor artwork", publish_at: ago(20), cta_label: "See the rules", cta_url: "/dashboard/rules" },
      { id: ids[3], title: "Previous promotion", publish_at: ago(120), popup_until: ago(90) },
    ].map((item) => ({ body: "**Welcome, managers.**\n\nExplore the latest news from Pingisligan Fantasy.\n\n- Check your squad before the deadline.\n- Find every update in your inbox.\n\n<script>window.announcementInjected=true</script>\n\n[Unsafe link](javascript:alert(1))\n\n![Hidden image](https://example.invalid/tracker.png)", published: true, popup_enabled: true, priority: "normal", category: "news", image_path: null, image_alt: null, cta_label: null, cta_url: null, popup_until: null, ...item }))), "Seed browser announcements");
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, f);
    const onboarding = page.getByRole("dialog", { name: "Name your fantasy team" });
    await expect(onboarding).toBeVisible();
    await expect(popup).not.toBeVisible();
    await onboarding.getByRole("textbox", { name: "Team name" }).fill(`Announcement manager ${f.id.slice(0, 8)}`);
    await onboarding.getByRole("button", { name: "Create my team" }).click();
    await expect(onboarding).not.toBeVisible();
    await expect(popup.getByRole("heading", { name: "Important gameweek update" })).toBeVisible();
    await expect(popup.getByText("1 of 3", { exact: true })).toBeVisible();
    await expect(popup.getByRole("button", { name: /Skip remaining/ })).toHaveCount(0);
    await expect(popup.locator("script, img")).toHaveCount(0);
    await expect(popup.getByRole("link", { name: "Unsafe link" })).toHaveCount(0);
    expect(await page.evaluate(() => window.announcementInjected)).toBeUndefined();
    await page.evaluate(() => document.fonts.ready);
    await popup.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: testInfo.outputPath("dashboard-high-popup-390.png") });
    await popup.getByRole("button", { name: "Dismiss and continue" }).click();
    await expect(popup.getByRole("heading", { name: "New player statistics" })).toBeVisible();
    await expect(popup.getByText("2 of 3", { exact: true })).toBeVisible();
    const failAction = async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) await route.fulfill({ status: 503, body: "Temporarily unavailable" });
      else await route.continue();
    };
    await page.route("**/dashboard/**", failAction);
    await popup.getByRole("button", { name: "Dismiss and continue" }).click();
    await expect(popup.getByRole("alert")).toContainText("Could not save");
    await expect(popup.getByRole("heading", { name: "New player statistics" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("dashboard-popup-save-error-390.png") });
    await page.unroute("**/dashboard/**", failAction);
    await popup.getByRole("button", { name: "Dismiss and continue" }).click();
    await expect(popup.getByRole("heading", { name: "Your next sponsored gameweek" })).toBeVisible();
    await expect(popup.getByText("3 of 3", { exact: true })).toBeVisible();
    await expect(popup.getByAltText("Fantasy Pingisligan sponsor artwork")).toBeVisible();
    await expect.poll(() => popup.getByAltText("Fantasy Pingisligan sponsor artwork").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      const bounds = await popup.boundingBox();
      expect(bounds.width).toBeLessThanOrEqual(Math.min(viewport.width * 0.9, 448) + 1);
      expect(bounds.height).toBeLessThanOrEqual(viewport.height * 0.85 + 1);
      expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)).toBeLessThan(2);
      expect(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2)).toBeLessThan(2);
      await expect(popup.getByRole("button", { name: "Dismiss", exact: true })).toBeInViewport({ ratio: 1 });
      const art = await popup.getByAltText("Fantasy Pingisligan sponsor artwork").boundingBox();
      expect(art.height).toBeLessThanOrEqual(viewport.width < 640 ? Math.min(176, viewport.height * 0.24) + 1 : 177);
      await popup.getByRole("link", { name: "See the rules" }).scrollIntoViewIfNeeded();
      await expect(popup.getByRole("link", { name: "See the rules" })).toBeInViewport({ ratio: 1 });
      await popup.getByText("3 of 3", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`dashboard-sponsor-popup-${viewport.width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await popup.getByRole("button", { name: "Skip remaining for 24 hours" }).click();
    await expect(popup).not.toBeVisible();
    const prefs = checked(await f.user.from("announcement_user_preferences").select("snoozed_until").single(), "Read browser snooze");
    expect(Date.parse(prefs.snoozed_until)).toBeGreaterThan(Date.now() + 23 * 60 * 60_000);
    const state = checked(await f.user.from("announcement_user_state").select("announcement_id, dismissed_at"), "Read browser dismissals");
    expect(state.map((item) => item.announcement_id).sort()).toEqual(ids.slice(0, 2).sort());
    expect(state.every((item) => item.dismissed_at)).toBe(true);
    await page.reload();
    await expect(page.getByRole("button", { name: "Open announcements (2 unread)" })).toBeVisible();
    await expect(popup).not.toBeVisible();

    secondDevice = await browser.newContext();
    const otherPage = await secondDevice.newPage();
    await login(otherPage, f);
    await expect(otherPage.getByRole("button", { name: "Open announcements (2 unread)" })).toBeVisible();
    await expect(otherPage.getByRole("dialog", { name: "Announcement", exact: true })).not.toBeVisible();
    await secondDevice.close();
    secondDevice = null;

    await page.getByRole("button", { name: "Open announcements (2 unread)" }).click();
    await expect(inbox).toBeVisible();
    await expect(inbox.getByText("Dismissed updates stay here whenever you need them.")).toHaveCount(0);
    await expect(inbox.getByRole("button", { name: /Previous promotion/ })).toBeVisible();
    expect(checked(await f.user.rpc("get_my_announcement_summary"), "Unread after list").unread_count).toBe(2);
    await expect(inbox.getByText("Sponsored", { exact: true })).toBeVisible();
    await expect(inbox.getByText("Welcome, managers.", { exact: false }).first()).toBeVisible();
    await expect(inbox.getByRole("listitem").filter({ hasText: "Your next sponsored gameweek" }).getByLabel("Unread")).toBeVisible();
    await expect(inbox.getByRole("listitem").filter({ hasText: "New player statistics" }).getByLabel("Unread")).toHaveCount(0);
    for (const width of [320, 390, 639, 640, 641, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const closeBounds = await inbox.getByRole("button", { name: "Close announcements" }).boundingBox();
      expect(closeBounds.y + closeBounds.height).toBeLessThanOrEqual(width === 1440 ? 900 : 844);
      await expect.poll(() => inbox.evaluate((element) => element.matches(":modal"))).toBe(width < 640);
      const bounds = await inbox.boundingBox();
      if (width < 640) {
        expect(bounds.x).toBe(0);
        expect(bounds.y).toBe(0);
        expect(bounds.width).toBe(width);
        expect(bounds.height).toBe(844);
      } else {
        const bell = await page.getByRole("button", { name: /^Open announcements/ }).boundingBox();
        expect(Math.abs(bounds.x - bell.x)).toBeLessThan(2);
        expect(bounds.y).toBeGreaterThanOrEqual(bell.y + bell.height + 8);
        expect(bounds.width).toBeLessThanOrEqual(400);
        expect(bounds.height).toBeLessThanOrEqual(576);
        expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
      }
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`dashboard-inbox-${width}.png`) });
    }
    // Older cards remain reachable inside the compact desktop panel.
    await inbox.getByRole("button", { name: /Previous promotion/ }).scrollIntoViewIfNeeded();
    await expect(inbox.getByRole("button", { name: /Previous promotion/ })).toBeInViewport();
    // A desktop outside click closes the non-modal panel without navigating.
    await page.getByRole("heading", { name: /Announcement manager/ }).click();
    await expect(inbox).not.toBeVisible();
    await page.getByRole("button", { name: /^Open announcements/ }).click();
    await inbox.getByRole("button", { name: /Your next sponsored gameweek/ }).click();
    await expect(inbox.getByRole("heading", { name: "Your next sponsored gameweek" })).toBeVisible();
    await expect.poll(async () => checked(await f.user.rpc("get_my_announcement_summary"), "Unread after detail").unread_count).toBe(1);
    await expect(inbox.getByAltText("Fantasy Pingisligan sponsor artwork")).toBeVisible();
    await expect.poll(() => inbox.getByAltText("Fantasy Pingisligan sponsor artwork").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("dashboard-inbox-detail-1440.png") });
    const pageScroll = await page.evaluate(() => window.scrollY);
    await inbox.getByRole("link", { name: "See the rules" }).scrollIntoViewIfNeeded();
    await expect(inbox.getByRole("link", { name: "See the rules" })).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
    await page.screenshot({ path: testInfo.outputPath("dashboard-inbox-detail-bottom-1440.png") });
    await inbox.getByRole("button", { name: "All announcements", exact: true }).scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(inbox.getByAltText("Fantasy Pingisligan sponsor artwork")).toBeVisible();
    await expect.poll(() => inbox.getByAltText("Fantasy Pingisligan sponsor artwork").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("dashboard-inbox-detail-390.png") });
    await inbox.getByRole("button", { name: "All announcements", exact: true }).click();
    await expect(inbox.getByRole("listitem").filter({ hasText: "Your next sponsored gameweek" }).getByLabel("Unread")).toHaveCount(0);
    // The same renderer contains both wide banners and opaque square artwork without distortion.
    for (const variant of artworkVariants) {
      checked(await f.admin.from("announcements").update({ image_path: variant.path, image_alt: variant.label }).eq("id", ids[2]), "Select artwork variant");
      await inbox.getByRole("button", { name: /Your next sponsored gameweek/ }).click();
      const image = inbox.getByAltText(variant.label);
      await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const dimensions = await image.evaluate((element) => ({
          actual: element.getBoundingClientRect().width / element.getBoundingClientRect().height,
          original: element.naturalWidth / element.naturalHeight,
          height: element.getBoundingClientRect().height,
        }));
        expect(Math.abs(dimensions.actual - dimensions.original)).toBeLessThan(0.02);
        expect(dimensions.height).toBeLessThanOrEqual(177);
        await page.screenshot({ path: testInfo.outputPath(`dashboard-inbox-${variant.capture}-${width}.png`) });
      }
      await inbox.getByRole("button", { name: "All announcements", exact: true }).click();
    }
    checked(await f.admin.from("announcements").update({ image_path: artwork, image_alt: "Fantasy Pingisligan sponsor artwork" }).eq("id", ids[2]), "Restore square artwork");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press("Escape");
    await expect(inbox).not.toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await page.getByRole("link", { name: "Leagues", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/leagues/);
    await expect(popup).not.toBeVisible();

    // A new High notice bypasses an existing Normal snooze on return.
    checked(await f.admin.from("announcements").insert({ id: ids[4], title: "Urgent maintenance notice", body: "A rare important notice.", published: true, priority: "high", popup_enabled: true, publish_at: ago(1) }), "Publish urgent notice");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(popup.getByRole("heading", { name: "Urgent maintenance notice" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup).not.toBeVisible();

    // Expire only the fixture's snooze; no business-rule bypass or populated-stack reset.
    checked(await f.admin.from("announcement_user_preferences").update({ snoozed_until: ago(1) }).eq("user_id", f.userId), "Advance snooze fixture");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(popup.getByRole("heading", { name: "Your next sponsored gameweek" })).toBeVisible();
    await popup.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(popup).not.toBeVisible();
    // A newly published Normal item is eligible on the next visit in the same login session.
    checked(await f.admin.from("announcements").insert({ id: ids[5], title: "Later ordinary news", body: "A new announcement on your next visit.", published: true, popup_enabled: true, publish_at: ago(0) }), "Publish later news");
    await page.reload();
    await expect(popup.getByRole("heading", { name: "Later ordinary news" })).toBeVisible();
    await expect(popup.getByText("1 of 1", { exact: true })).toBeVisible();
    await popup.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(popup).not.toBeVisible();
    // Opening the inbox preserves an unsaved captain change on the squad page.
    await page.getByRole("link", { name: "Squad", exact: true }).click();
    await page.getByRole("button", { name: "Open actions for Functional Player2" }).click();
    await page.getByRole("button", { name: "Make Functional Player2 captain" }).click();
    const saveButton = page.getByLabel("Squad editor").getByRole("button", { name: /^Save/i });
    await expect(saveButton).toBeEnabled();
    await page.getByRole("button", { name: /^Open announcements/ }).click();
    await expect(inbox).toBeVisible();
    await inbox.getByRole("button", { name: "Close announcements" }).click();
    await expect(saveButton).toBeEnabled();

    // History is bounded to 20 rows per read and can load older items.
    checked(await f.admin.from("announcements").insert(ids.slice(6).map((id, index) => ({ id, title: `Archive update ${index}`, body: "Historical news.", published: true, publish_at: ago(200 + index) }))), "Seed paginated history");
    await page.getByRole("button", { name: /^Open announcements/ }).click();
    await expect(inbox.getByRole("listitem")).toHaveCount(20);
    await inbox.getByRole("button", { name: "Load older announcements" }).click();
    await expect(inbox.getByRole("listitem")).toHaveCount(27);
    await expect(inbox.getByRole("button", { name: "Load older announcements" })).toHaveCount(0);
    await inbox.getByRole("button", { name: "Close announcements" }).click();
    // Review sparse inboxes too: the user's local example has just one item.
    checked(await f.admin.from("announcements").delete().in("id", ids.filter((id) => id !== ids[2])), "Keep one fixture announcement");
    await page.getByRole("button", { name: /^Open announcements/ }).click();
    await expect(inbox.getByRole("listitem")).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("dashboard-inbox-single-390.png") });
    await inbox.getByRole("button", { name: "Close announcements" }).click();
    checked(await f.admin.from("announcements").delete().eq("id", ids[2]), "Empty fixture inbox");
    await page.getByRole("button", { name: /^Open announcements/ }).click();
    await expect(inbox.getByRole("heading", { name: /all caught up/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("dashboard-inbox-empty-390.png") });
    await inbox.getByRole("button", { name: "Close announcements" }).click();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    if (secondDevice) await secondDevice.close();
    checked(await f.admin.storage.from("announcement-artwork").remove([artwork, ...artworkVariants.map((variant) => variant.path)]), "Remove browser artwork");
    checked(await f.admin.from("announcements").delete().in("id", ids), "Remove browser announcements");
    await cleanupFixture(f);
  }
});

test("an initially empty visit discovers new popups on return and preserves the active sequence", async ({ page }) => {
  const f = await createFixture();
  const ids = Array.from({ length: 8 }, () => randomUUID());
  const popup = page.getByRole("dialog", { name: "Announcement", exact: true });
  try {
    checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save return-reader squad");
    // The first empty summary used to set a login-wide completion flag.
    const initialCheck = page.waitForResponse((response) => response.url().includes("/rpc/get_my_announcement_summary") && response.ok());
    await login(page, f);
    await initialCheck;
    await expect(popup).not.toBeVisible();
    await page.getByRole("link", { name: "Squad", exact: true }).click();
    await page.getByRole("button", { name: "Open actions for Functional Player2" }).click();
    const blockingDialog = page.getByRole("dialog", { name: /Functional Player2/ });
    await expect(blockingDialog).toBeVisible();
    checked(await f.admin.from("announcements").insert([
      { id: ids[0], title: "New Normal after an empty visit", publish_at: ago(5) },
      { id: ids[1], title: "New High after an empty visit", priority: "high", publish_at: ago(1) },
      { id: ids[2], title: "Inbox only", popup_enabled: false },
      { id: ids[3], title: "Scheduled for later", publish_at: ago(-60) },
      { id: ids[4], title: "Expired promotion", publish_at: ago(10), popup_until: ago(5) },
      { id: ids[5], title: "Unpublished draft", published: false },
    ].map((item) => ({ body: "A concise update for managers.", published: true, popup_enabled: true, priority: "normal", publish_at: ago(20), ...item }))), "Publish return fixtures");
    const returnCheck = page.waitForResponse((response) => response.url().includes("/rpc/get_my_announcement_summary") && response.ok());
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await returnCheck;
    await expect(popup).not.toBeVisible();
    await page.keyboard.press("Escape");
    await expect(blockingDialog).not.toBeVisible();
    await expect(popup.getByRole("heading", { name: "New High after an empty visit" })).toBeVisible();
    await popup.getByRole("button", { name: "Dismiss and continue" }).click();
    await expect(popup.getByRole("heading", { name: "New Normal after an empty visit" })).toBeVisible();
    // New High follows the current announcement; new Normal waits until another visit.
    checked(await f.admin.from("announcements").insert([
      { id: ids[6], title: "High while reading", priority: "high" },
      { id: ids[7], title: "Normal for the next visit", priority: "normal" },
    ].map((item) => ({ body: "Another concise update.", published: true, popup_enabled: true, publish_at: ago(0), ...item }))), "Publish while reading");
    const activeCheck = page.waitForResponse((response) => response.url().includes("/rpc/get_my_announcement_summary") && response.ok());
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await activeCheck;
    await expect(popup.getByRole("heading", { name: "New Normal after an empty visit" })).toBeVisible();
    await popup.getByRole("button", { name: "Dismiss and continue" }).click();
    await expect(popup.getByRole("heading", { name: "High while reading" })).toBeVisible();
    await popup.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(popup).not.toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(popup.getByRole("heading", { name: "Normal for the next visit" })).toBeVisible();
    // Reload reconstructs only remaining items; earlier persisted dismissals do not restart.
    await page.reload();
    await expect(popup.getByRole("heading", { name: "Normal for the next visit" })).toBeVisible();
    await expect(popup.getByText("1 of 1", { exact: true })).toBeVisible();
    await popup.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(popup).not.toBeVisible();
    checked(await f.admin.from("announcements").update({ publish_at: ago(0) }).eq("id", ids[3]), "Reach scheduled publication");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(popup.getByRole("heading", { name: "Scheduled for later" })).toBeVisible();
    await popup.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(popup).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Open announcements (2 unread)" })).toBeVisible();
    await expect(popup).not.toBeVisible();
    const summary = checked(await f.user.rpc("get_my_announcement_summary"), "No replay or inbox-only popups");
    expect(summary.pending).toEqual([]);
  } finally {
    checked(await f.admin.from("announcements").delete().in("id", ids), "Remove return fixtures");
    await cleanupFixture(f);
  }
});

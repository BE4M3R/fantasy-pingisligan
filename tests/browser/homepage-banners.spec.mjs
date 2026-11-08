import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { checked, cleanupFixture, complete, createFixture, lock, save, squad } from "../functional/fixture.mjs";

const minutes = (n) => new Date(Date.now() + n * 60_000).toISOString();

test("Home selects current on entry, preserves browsing, and supports secure weekly and season slides", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const f = await createFixture({ gameweeks: 6, competitions: true });
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const artwork = `${f.id}/home-sponsor.png`;
  const opaqueArtwork = `${f.id}/home-sponsor-opaque.jpg`;
  const errors = [];
  let mobile;
  const captureErrors = (p) => {
    p.on("pageerror", (error) => errors.push(error.message));
    p.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  };
  try {
    checked(await save(f, squad([f.players[0], f.players[2], f.players[4], f.players[6], f.players[1], f.players[3]])), "Save squad");
    await lock(f);
    await complete(f);
    checked(await f.admin.storage.from("announcement-artwork").upload(artwork, await readFile(new URL("../../public/branding/pingisligan-fantasy-mark-transparent-v2.png", import.meta.url)), { contentType: "image/png" }), "Upload logo");
    checked(await f.admin.storage.from("announcement-artwork").upload(opaqueArtwork, await readFile(new URL("../../public/club-logos/sbtf-eskilstuna.jpg", import.meta.url)), { contentType: "image/jpeg" }), "Upload opaque logo");
    checked(await f.admin.from("homepage_banners").insert([
      { id: ids[0], gameweek_id: f.weeks[0].id, content_ready: true, sponsor: "Historical partner" },
      { id: ids[1], gameweek_id: f.weeks[1].id, content_ready: true,
        description: "Win a premium training kit.", sponsor: "Fantasy Test Partner", image_path: artwork,
        image_alt: "Test partner artwork", cta_label: "Discover prize" },
      { id: ids[2], gameweek_id: f.weeks[2].id, content_ready: true, title: "Embargoed weekly title",
        description: "Embargoed weekly prize", sponsor: "Embargoed weekly sponsor", image_path: opaqueArtwork,
        image_alt: "Embargoed weekly logo" },
      { id: ids[3], kind: "season", published: true, publish_at: minutes(60), title: "The Grand Season Prize",
        description: "Win a premium table tennis kit.", sponsor: "Embargoed season partner",
        cta_label: "Explore the grand prize" },
    ], { defaultToNull: false }), "Prepare content");
    async function capture(p, region, index, name) {
      await expect.poll(() => region.locator(".sponsored-track").evaluate((element, selected) =>
        Math.abs(element.scrollLeft - selected * element.clientWidth), index)).toBeLessThan(1);
      await p.screenshot({ path: testInfo.outputPath(name) });
    }
    async function expectCompactInformation(region) {
      const card = region.locator('article[aria-hidden="false"]');
      await expect(card.getByText(/Sponsored by/)).toHaveCount(0);
      const logo = await card.locator(".sponsored-logo").boundingBox();
      for (const text of ["Discover prize", "Win a premium training kit."]) {
        const information = await card.getByText(text, { exact: true }).boundingBox();
        expect(information.x).toBeGreaterThanOrEqual(logo.x + logo.width);
        expect(information.y + information.height).toBeLessThanOrEqual(logo.y + logo.height + 1);
      }
      await expect(card.getByRole("link")).toHaveAccessibleName(/View competition/);
      await expect(card.locator(".sponsored-hint-arrow")).toBeVisible();
      await expect(card.getByText("See more", { exact: true })).toHaveCount(0);
    }
    captureErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByLabel("Email").fill(f.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await page.getByRole("link", { name: "Home", exact: true }).click();
    const carousel = page.getByRole("region", { name: "Gameweek highlights" });
    const track = carousel.locator(".sponsored-track");
    const status = carousel.getByRole("status");
    await expect(status).toHaveText("Highlight 2 of 5: The Weekly Smash GW 2");
    await expect.poll(() => track.evaluate((el) => Math.abs(el.scrollLeft - el.clientWidth))).toBeLessThan(1);
    await expect(carousel.getByRole("heading", { name: "The Weekly Smash GW 2" })).toBeVisible();
    await expect(carousel.getByRole("button", { name: /^Show highlight/ })).toHaveCount(5);
    expect(await page.content()).not.toContain("Embargoed");
    await expect(carousel.getByText("Win a premium training kit.", { exact: true })).toBeVisible();
    await expect(carousel.getByRole("link")).toHaveAttribute("href", "/competitions/gameweek/2");
    await expect.poll(() => carousel.getByAltText("Test partner artwork").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await expectCompactInformation(carousel);
    await page.evaluate(() => document.fonts.ready);
    await capture(page, carousel, 1, "home-current-desktop-1440.png");
    await track.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(status).toHaveText("Highlight 1 of 5: The Weekly Smash GW 1");
    await expect(carousel.getByText("Awaiting winner confirmation", { exact: true })).toBeVisible();
    // Ordinary Home interactions must not put a browsing user back on current.
    await page.getByRole("button", { name: "Open announcements" }).click();
    await page.keyboard.press("Escape");
    await expect(status).toHaveText("Highlight 1 of 5: The Weekly Smash GW 1");
    await page.getByRole("link", { name: "Squad", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(status).toHaveText("Highlight 2 of 5: The Weekly Smash GW 2");
    await track.focus();
    await page.keyboard.press("End");
    await expect(status).toHaveText("Highlight 5 of 5: Season Competition");
    await expect(carousel.locator('article[aria-hidden="false"]').getByText("Coming soon", { exact: true })).toBeVisible();
    await expect(carousel.locator('article[aria-hidden="false"]').getByText("Locked · Coming soon", { exact: true })).toHaveCount(0);
    await expect(carousel.getByRole("link")).toHaveAttribute("href", "/competitions/season");
    await capture(page, carousel, 4, "home-season-coming-soon-desktop-1440.png");
    await carousel.getByRole("link").click();
    await expect(page).toHaveURL(/\/competitions\/season$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Prize details coming soon");
    expect(await page.content()).not.toContain("Embargoed season partner");
    await page.getByRole("link", { name: "Back to Fantasy", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/overview$/);
    // Browser history entry also resets to current, rather than restoring season.
    await page.getByRole("link", { name: "Squad", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("region", { name: "Squad editor" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\/overview$/);
    await expect(status).toHaveText("Highlight 2 of 5: The Weekly Smash GW 2");
    for (const width of [320, 390, 639, 640, 641, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(carousel.getByRole("heading", { name: "The Weekly Smash GW 2" })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await carousel.boundingBox()).height).toBeLessThan(180);
      await expectCompactInformation(carousel);
      if (width < 640) await expect(carousel.getByRole("button", { name: "Next highlight" })).toBeHidden();
      else await expect(carousel.getByRole("button", { name: "Next highlight" })).toBeVisible();
    }

    mobile = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const phone = await mobile.newPage();
    captureErrors(phone);
    await phone.goto(new URL("/dashboard/overview", page.url()).href);
    const phoneCarousel = phone.getByRole("region", { name: "Gameweek highlights" });
    const phoneStatus = phoneCarousel.getByRole("status");
    await expect(phoneStatus).toHaveText("Highlight 2 of 5: The Weekly Smash GW 2");
    await phone.evaluate(() => document.fonts.ready);
    await capture(phone, phoneCarousel, 1, "home-current-mobile-390.png");
    await expectCompactInformation(phoneCarousel);
    const cdp = await mobile.newCDPSession(phone);
    async function swipe(direction = "next") {
      const bounds = await phoneCarousel.locator(".sponsored-track").boundingBox();
      const y = bounds.y + bounds.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: direction === "next" ? 330 : 60, y }] });
      for (const x of direction === "next" ? [300, 270, 240, 210, 180, 150, 120, 90, 60] : [90, 120, 150, 180, 210, 240, 270, 300, 330]) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await swipe();
    await expect(phoneStatus).toHaveText("Highlight 3 of 5: The Weekly Smash GW 3");
    await expect(phoneCarousel.getByRole("link")).toHaveCount(0);
    await capture(phone, phoneCarousel, 2, "home-upcoming-mobile-390.png");
    await phone.emulateMedia({ reducedMotion: "reduce" });
    expect(await phoneCarousel.locator(".sponsored-track").evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe("auto");
    await phoneCarousel.getByRole("button", { name: "Show highlight 4: The Weekly Smash GW 4" }).tap();
    await expect(phoneStatus).toHaveText("Highlight 4 of 5: The Weekly Smash GW 4");
    await expect(phoneCarousel.getByRole("button", { name: /GW 5|GW 6/ })).toHaveCount(0);

    checked(await f.admin.from("homepage_banners").update({ publish_at: minutes(-1) }).eq("id", ids[3]), "Reveal season");
    await phone.reload();
    await phoneCarousel.getByRole("button", { name: "Show highlight 5: The Grand Season Prize" }).tap();
    await expect(phoneCarousel.getByText("Explore the grand prize", { exact: true })).toBeVisible();
    await expect(phoneCarousel.getByText("Embargoed season partner", { exact: true })).toHaveCount(0);
    await expect(phoneCarousel.getByText("Win a premium table tennis kit.", { exact: true })).toBeVisible();
    await capture(phone, phoneCarousel, 4, "home-season-mobile-390.png");
    await swipe("previous");
    await expect(phone).toHaveURL(/\/dashboard\/overview$/);
    await expect(phoneStatus).toHaveText("Highlight 4 of 5: The Weekly Smash GW 4");
    await phoneCarousel.getByRole("button", { name: "Show highlight 5: The Grand Season Prize" }).tap();
    await phoneCarousel.getByRole("heading", { name: "The Grand Season Prize" }).tap();
    await expect(phone).toHaveURL(/\/competitions\/season$/);
    await phone.goBack();
    await expect(phone).toHaveURL(/\/dashboard\/overview$/);
    await expect(phoneStatus).toHaveText("Highlight 2 of 5: The Weekly Smash GW 2");

    // Every revealed competition links to its dedicated public page.
    checked(await f.admin.from("homepage_banners").update({ image_path: opaqueArtwork }).eq("id", ids[1]), "Show logo with derived page link");
    await phone.goto(new URL("/dashboard/overview", page.url()).href);
    await expect(phoneCarousel.getByRole("link")).toHaveAttribute("href", "/competitions/gameweek/2");
    await expect.poll(() => phoneCarousel.getByRole("img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await capture(phone, phoneCarousel, 1, "home-opaque-sponsor-mobile-390.png");
    await phone.route("**/storage/v1/object/sign/announcement-artwork/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: "invalid image" }));
    await phone.reload();
    await expect(phoneCarousel.locator('article[aria-hidden="false"]').getByText("Discover prize", { exact: true })).toBeVisible();
    await expect(phoneCarousel.getByText("Win a premium training kit.", { exact: true })).toBeVisible();
    await expect(phoneCarousel.getByRole("img")).toHaveCount(0);
    checked(await f.admin.from("homepage_banners").delete().eq("id", ids[1]), "Remove optional current content");
    await phone.reload();
    await expect(phoneCarousel.getByText("Competition details coming soon", { exact: true })).toBeVisible();
    await expect(phoneStatus).toHaveText("Highlight 2 of 5: The Weekly Smash GW 2");
    for (const week of f.weeks.slice(1)) {
      checked(await f.admin.from("fantasy_gameweeks").update({ lock_at: minutes(-10), unlock_at: minutes(-1) }).eq("id", week.id), "Pass remaining deadlines");
      await complete(f, week);
    }
    await phone.reload();
    await expect(phoneStatus).toHaveText("Highlight 6 of 7: The Weekly Smash GW 6");
    await expect(phoneCarousel.locator('article[aria-hidden="false"]').getByText("Awaiting winner confirmation", { exact: true })).toBeVisible();
    await capture(phone, phoneCarousel, 5, "home-completed-mobile-390.png");
    expect(errors).toEqual([]);
  } finally {
    if (mobile) await mobile.close();
    checked(await f.admin.storage.from("announcement-artwork").remove([artwork, opaqueArtwork]), "Remove artwork");
    checked(await f.admin.from("homepage_banners").delete().in("id", ids), "Remove content");
    await cleanupFixture(f);
  }
});

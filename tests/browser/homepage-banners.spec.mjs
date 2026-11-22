import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { checked, cleanupFixture, complete, createFixture, lock, save, squad } from "../functional/fixture.mjs";

const minutes = (n) => new Date(Date.now() + n * 60_000).toISOString();

async function checkCompetitionsOverview(page, testInfo, winningName) {
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Dashboard", exact: true });
  await expect(nav.getByRole("link")).toHaveText(["Home", "Squad", "Competitions", "Leagues", "Fixtures"]);
  const competitionsTab = nav.getByRole("link", { name: "Competitions", exact: true });
  await competitionsTab.click();
  await expect(page).toHaveURL(/\/competitions$/);
  await expect(competitionsTab).toHaveAttribute("aria-current", "page");

  const current = page.getByRole("region", { name: "Current competition", exact: true });
  await expect(current.getByRole("link")).toHaveAttribute("href", "/competitions/gameweek/2");
  await expect(current.getByText("Ongoing", { exact: true })).toBeVisible();
  await expect(current.getByText("Win a premium training kit.", { exact: true })).toBeVisible();
  await expect.poll(() => current.getByAltText("Test partner artwork").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  expect(await page.content()).not.toContain("Embargoed weekly");

  const upcoming = page.getByRole("region", { name: "Upcoming competitions", exact: true });
  const scheduled = upcoming.getByRole("button", { name: "Prize reveal for Gameweek 3", exact: true });
  const revealedEarly = upcoming.getByRole("button", { name: "Prize reveal for Gameweek 4", exact: true });
  await expect(scheduled.getByText("A surprise for our next champion... 👀")).toBeVisible();
  await expect(upcoming.getByRole("link")).toHaveCount(0);
  await expect(upcoming.getByText("Summer training voucher", { exact: true })).toBeHidden();
  await revealedEarly.click();
  const earlyPopup = page.getByRole("dialog", { name: "Gameweek 4 prize", exact: true });
  await expect(earlyPopup.getByText("Summer training voucher", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(earlyPopup).toBeHidden();

  await scheduled.scrollIntoViewIfNeeded();
  const card = await scheduled.boundingBox();
  const clickY = card.y + 12;
  await page.mouse.click(card.x + card.width / 2, clickY);
  const popup = page.getByRole("dialog", { name: "Gameweek 3 prize reveal", exact: true });
  await expect(popup.locator("time")).toHaveText("Thu 19 Nov · 18:00");
  await expect.poll(() => popup.evaluate((dialog, y) => {
    const bounds = dialog.getBoundingClientRect();
    return Math.abs(bounds.top + bounds.height / 2 - y);
  }, clickY)).toBeLessThan(2);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("competitions-reveal-mobile-390.png") });
  const background = await page.locator('button[aria-label="Prize reveal for Gameweek 4"]').boundingBox();
  // Tap the exposed edge of the neighboring card behind the backdrop.
  await page.mouse.click(background.x + 4, background.y + background.height / 2);
  await expect(popup).toBeHidden();
  await expect(earlyPopup).toBeHidden();
  await expect(page).toHaveURL(/\/competitions$/);

  const hallOfFame = page.getByRole("region", { name: "Hall of Fame", exact: true });
  const winnerCard = hallOfFame.getByRole("link", { name: new RegExp(winningName) });
  await expect(winnerCard.getByRole("heading", { name: "Gameweek 1", exact: true })).toBeVisible();
  for (const width of [320, 390, 639, 640, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflowingTabs = await nav.getByRole("link").evaluateAll((links) => links.flatMap((link) => {
      const label = link.querySelector("span");
      const bounds = label.getBoundingClientRect();
      const tab = link.getBoundingClientRect();
      return bounds.left < tab.left || bounds.right > tab.right ? [label.textContent] : [];
    }));
    expect(overflowingTabs, `Navigation labels outside their tabs at ${width}px`).toEqual([]);
    if ([320, 390, 1440].includes(width)) {
      await page.screenshot({ path: testInfo.outputPath(`competitions-overview-${width}.png`) });
    }
  }

  await winnerCard.click();
  await expect(page).toHaveURL(/\/competitions\/gameweek\/1$/);
  await expect(page.getByRole("heading", { name: "Competition leaderboard" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Competitions", exact: true }).click();
  await expect(page).toHaveURL(/\/competitions$/);
  await page.getByLabel("Open settings", { exact: true }).click();
  const rules = page.getByRole("link", { name: "Rules", exact: true });
  await expect(rules).toHaveAttribute("href", "/rules");
  await rules.click();
  await expect(page).toHaveURL(/\/rules$/);
}

test("Home and Competitions share published prizes, upcoming teasers and confirmed winners", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const f = await createFixture({ gameweeks: 6, competitions: true, seasonCompetitions: true });
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
      { id: ids[0], gameweek_id: f.weeks[0].id, content_ready: true, sponsor: "Historical partner", prize_title: "A champion's shirt" },
      { id: ids[1], gameweek_id: f.weeks[1].id, content_ready: true,
        prize_title: "Win a premium training kit.", sponsor: "Fantasy Test Partner", image_path: artwork,
        image_alt: "Test partner artwork" },
      { id: ids[2], gameweek_id: f.weeks[2].id, content_ready: true, title: "Embargoed weekly title",
        prize_reveal_at: "2099-11-19T17:00:00Z", prize_title: "Embargoed weekly prize", teaser: "A surprise for our next champion... 👀", sponsor: "Embargoed weekly sponsor", image_path: opaqueArtwork,
        image_alt: "Embargoed weekly logo" },
      { id: ids[3], kind: "season", published: true, publish_at: minutes(60), title: "The Grand Season Prize",
        prize_title: "Win a premium table tennis kit.", sponsor: "Embargoed season partner" },
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
      for (const text of ["Win a premium training kit."]) {
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
    await expect(status).toHaveText("Highlight 2 of 7: Gameweek 2 Competition");
    await expect.poll(() => track.evaluate((el) => Math.abs(el.scrollLeft - el.clientWidth))).toBeLessThan(1);
    await expect(carousel.getByRole("heading", { name: "Gameweek 2 Competition" })).toBeVisible();
    await expect(carousel.locator('article[aria-hidden="false"]').getByText("Ongoing", { exact: true })).toBeVisible();
    await expect(carousel.getByRole("button", { name: /^Show highlight/ })).toHaveCount(7);
    expect(await page.content()).not.toContain("Embargoed");
    await expect(carousel.locator('article[aria-hidden="false"]').getByText("Win a premium training kit.", { exact: true })).toBeVisible();
    await expect(carousel.getByRole("link")).toHaveAttribute("href", "/competitions/gameweek/2");
    await expect.poll(() => carousel.getByAltText("Test partner artwork").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    expect(await carousel.innerText()).toContain("Win a premium training kit.");
    await expectCompactInformation(carousel);
    await page.evaluate(() => document.fonts.ready);
    await capture(page, carousel, 1, "home-current-desktop-1440.png");
    await track.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(status).toHaveText("Highlight 1 of 7: Gameweek 1 Competition");
    await expect(carousel.getByText("Winner pending", { exact: true })).toBeVisible();
    // Ordinary Home interactions must not put a browsing user back on current.
    await page.getByRole("button", { name: "Open announcements" }).click();
    await page.keyboard.press("Escape");
    await expect(status).toHaveText("Highlight 1 of 7: Gameweek 1 Competition");
    await page.getByRole("link", { name: "Squad", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(status).toHaveText("Highlight 2 of 7: Gameweek 2 Competition");
    await track.focus();
    await page.keyboard.press("End");
    await expect(status).toHaveText("Highlight 7 of 7: Season Competition");
    await expect(carousel.locator('article[aria-hidden="false"]').getByText("Coming soon", { exact: true })).toBeVisible();
    await expect(carousel.locator('article[aria-hidden="false"]').getByText("Locked · Coming soon", { exact: true })).toHaveCount(0);
    await expect(carousel.getByRole("link")).toHaveAttribute("href", "/competitions/season");
    await capture(page, carousel, 6, "home-season-coming-soon-desktop-1440.png");
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
    await expect(status).toHaveText("Highlight 2 of 7: Gameweek 2 Competition");
    for (const width of [320, 390, 639, 640, 641, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(carousel.getByRole("heading", { name: "Gameweek 2 Competition" })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await carousel.boundingBox()).height).toBeLessThan(180);
      const bell = await page.getByRole("button", { name: "Open announcements", exact: true }).boundingBox();
      const settings = await page.getByLabel("Open settings", { exact: true }).boundingBox();
      expect([bell.width, bell.height]).toEqual([settings.width, settings.height]);
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
    await expect(phoneStatus).toHaveText("Highlight 2 of 7: Gameweek 2 Competition");
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
    await expect(phoneStatus).toHaveText("Highlight 3 of 7: Gameweek 3 Competition");
    await expect(phoneCarousel.getByRole("link")).toHaveCount(0);
    await expect(phoneCarousel.locator('article[aria-hidden="false"]').getByText("Coming soon", { exact: true })).toBeVisible();
    await expect(phoneCarousel.getByText("A surprise for our next champion... 👀", { exact: true })).toBeVisible();
    const reveal = phoneCarousel.locator('article[aria-hidden="false"] time');
    await expect(reveal).toHaveText("Thu 19 Nov · 18:00");
    await expect(reveal).toHaveAttribute("datetime", "2099-11-19T17:00:00+00:00");
    await capture(phone, phoneCarousel, 2, "home-upcoming-mobile-390.png");
    for (const width of [320, 768, 1440]) {
      await phone.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(reveal).toBeInViewport();
      if (width === 1440) await capture(phone, phoneCarousel, 2, "home-upcoming-desktop-1440.png");
    }
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.emulateMedia({ reducedMotion: "reduce" });
    expect(await phoneCarousel.locator(".sponsored-track").evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe("auto");
    await phoneCarousel.getByRole("button", { name: "Show highlight 4: Gameweek 4 Competition" }).tap();
    await expect(phoneStatus).toHaveText("Highlight 4 of 7: Gameweek 4 Competition");
    await expect(phoneCarousel.getByRole("button", { name: /Gameweek (5|6) Competition/ })).toHaveCount(2);

    checked(await f.admin.from("homepage_banners").update({ publish_at: minutes(-1) }).eq("id", ids[3]), "Reveal season");
    await phone.reload();
    await phoneCarousel.getByRole("button", { name: "Show highlight 7: The Grand Season Prize" }).tap();
    await expect(phoneCarousel.getByText("Embargoed season partner", { exact: true })).toHaveCount(0);
    await expect(phoneCarousel.locator('article[aria-hidden="false"]').getByText("Win a premium table tennis kit.", { exact: true })).toBeVisible();
    await capture(phone, phoneCarousel, 6, "home-season-mobile-390.png");
    await swipe("previous");
    await expect(phone).toHaveURL(/\/dashboard\/overview$/);
    await expect(phoneStatus).toHaveText("Highlight 6 of 7: Gameweek 6 Competition");
    await phoneCarousel.getByRole("button", { name: "Show highlight 7: The Grand Season Prize" }).tap();
    await phoneCarousel.getByRole("heading", { name: "The Grand Season Prize" }).tap();
    await expect(phone).toHaveURL(/\/competitions\/season$/);
    await phone.goBack();
    await expect(phone).toHaveURL(/\/dashboard\/overview$/);
    await expect(phoneStatus).toHaveText("Highlight 2 of 7: Gameweek 2 Competition");

    // Every revealed competition links to its dedicated public page.
    checked(await f.admin.from("homepage_banners").update({ image_path: opaqueArtwork }).eq("id", ids[1]), "Show logo with derived page link");
    await phone.goto(new URL("/dashboard/overview", page.url()).href);
    await expect(phoneCarousel.getByRole("link")).toHaveAttribute("href", "/competitions/gameweek/2");
    await expect.poll(() => phoneCarousel.getByRole("img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await capture(phone, phoneCarousel, 1, "home-opaque-sponsor-mobile-390.png");

    // Reuse this fixture/session for the public winner page and Home priority.
    const winningName = "The Unstoppable Ping Pong Champions of Stockholm";
    checked(await f.user.from("fantasy_teams").update({ name: winningName }).eq("id", f.teamId), "Name winning team");
    checked(await f.admin.from("competition_publication").update({ competition_winner: f.teamId })
      .eq("gameweek_id", f.weeks[0].id), "Announce previous winner");
    await phone.reload();
    const active = phoneCarousel.locator('article[aria-hidden="false"]');
    await expect(phoneStatus).toHaveText("Highlight 1 of 7: Gameweek 1 Competition");
    await expect(active.getByText(winningName, { exact: true })).toBeVisible();
    await expect(active.getByText("Winner announced", { exact: true })).toBeVisible();
    await expect(active.getByText("A champion's shirt", { exact: true })).toBeVisible();
    await expect(active.getByText(/^Winner:/)).toHaveCount(0);
    for (const width of [320, 390, 768, 1440]) {
      await phone.setViewportSize({ width, height: 844 });
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const heading = await active.getByRole("heading").boundingBox();
      const label = await active.getByText("Winner announced", { exact: true }).boundingBox();
      expect(Math.abs(heading.y + heading.height / 2 - label.y - label.height / 2)).toBeLessThan(2);
      if (width === 390 || width === 1440) await phoneCarousel.screenshot({ path: testInfo.outputPath(`home-confirmed-winner-${width}.png`) });
    }

    // Use the same signed-in fixture with a revealed prize for a later round.
    checked(await f.admin.from("homepage_banners").insert({
      gameweek_id: f.weeks[3].id, content_ready: true, prize_title: "Summer training voucher", prize_reveal_at: minutes(-1),
    }), "Reveal a prize ahead of its Gameweek");
    await checkCompetitionsOverview(phone, testInfo, winningName);
    checked(await f.admin.from("homepage_banners").update({ prize_reveal_at: null }).eq("id", ids[2]), "Restore normal reveal for the remaining lifecycle checks");
    await phone.goto("/dashboard/overview");
    await expect(phoneStatus).toHaveText("Highlight 1 of 7: Gameweek 1 Competition");
    await phoneCarousel.getByRole("link", { name: /View competition/ }).click();
    const winner = phone.getByRole("region", { name: "Gameweek winner", exact: true });
    await expect(winner.getByText(winningName, { exact: true })).toBeVisible();
    await expect(phone.getByText("Winner announced", { exact: true })).toHaveCount(0);
    await expect(phone.getByText("Provisional", { exact: true })).toHaveCount(0);
    await expect(phone.getByAltText("Yasaka", { exact: true })).toHaveAttribute("src", "/branding/yasaka-www-grey.png");
    expect(await phone.content()).not.toContain(f.email);
    for (const width of [390, 1440]) {
      await phone.setViewportSize({ width, height: 844 });
      await phone.evaluate(() => document.fonts.ready);
      await phone.screenshot({ path: testInfo.outputPath(`gameweek-confirmed-winner-${width}.png`), fullPage: true });
    }
    checked(await f.admin.from("fantasy_gameweeks").update({ unlock_at: minutes(-49 * 60) })
      .eq("id", f.weeks[0].id), "Expire the winner's 48-hour feature window");
    await phone.goto(new URL("/dashboard/overview", page.url()).href);
    await expect(phoneStatus).toHaveText("Highlight 2 of 7: Gameweek 2 Competition");
    await phoneCarousel.getByRole("button", { name: "Show highlight 1: Gameweek 1 Competition" }).click();
    await expect(active.getByText(winningName, { exact: true })).toBeVisible();
    checked(await f.admin.from("competition_publication").update({ competition_winner: null })
      .eq("gameweek_id", f.weeks[0].id), "Withdraw winner");
    await phone.goto(new URL("/competitions/gameweek/1", page.url()).href);
    await expect(winner).toHaveCount(0);
    await expect(phone.getByRole("heading", { name: "Winner announcement", exact: true })).toBeVisible();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(new URL("/dashboard/overview", page.url()).href);
    await phone.route("**/storage/v1/object/sign/announcement-artwork/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: "invalid image" }));
    await phone.reload();
    await expect(phoneCarousel.locator('article[aria-hidden="false"]').getByText("Win a premium training kit.", { exact: true })).toBeVisible();
    await expect(phoneCarousel.getByRole("img")).toHaveCount(0);
    checked(await f.admin.from("homepage_banners").delete().eq("id", ids[1]), "Remove optional current content");
    await phone.reload();
    await expect(phoneCarousel.locator('article[aria-hidden="false"]').getByText("Competition details coming soon", { exact: true })).toBeVisible();
    await expect(phoneStatus).toHaveText("Highlight 2 of 7: Gameweek 2 Competition");
    for (const week of f.weeks.slice(1)) {
      checked(await f.admin.from("fantasy_gameweeks").update({ lock_at: minutes(-10), unlock_at: minutes(-1) }).eq("id", week.id), "Pass remaining deadlines");
      await complete(f, week);
    }
    await phone.reload();
    await expect(phoneStatus).toHaveText("Highlight 6 of 7: Gameweek 6 Competition");
    await expect(phoneCarousel.locator('article[aria-hidden="false"]').getByText("Winner pending", { exact: true })).toBeVisible();
    await capture(phone, phoneCarousel, 5, "home-completed-mobile-390.png");
    expect(errors).toEqual([]);
  } finally {
    if (mobile) await mobile.close();
    checked(await f.admin.storage.from("announcement-artwork").remove([artwork, opaqueArtwork]), "Remove artwork");
    checked(await f.admin.from("homepage_banners").delete().in("id", ids), "Remove content");
    await cleanupFixture(f);
  }
});

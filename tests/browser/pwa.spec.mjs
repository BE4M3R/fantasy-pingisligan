import { expect, test } from "@playwright/test";
import { checked, cleanupFixture, createFixture, save, squad } from "../functional/fixture.mjs";

test("regular browser keeps dashboard navigation and cookie-based sign-in and sign-out", async ({ page }, testInfo) => {
  const fixture = await createFixture();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    checked(await save(fixture, squad(fixture.players)), "Save browser test squad");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email").fill(fixture.email);
    await page.getByLabel("Password").fill(fixture.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/overview$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard\/overview$/);
    const manifest = page.locator('link[rel="manifest"]');
    await expect(manifest).toHaveCount(1);
    await expect(manifest).toHaveAttribute("href", "/manifest.webmanifest");

    const navigation = page.getByRole("navigation", { name: "Dashboard" });
    const documentStart = await page.evaluate(() => performance.timeOrigin);
    await navigation.getByRole("link", { name: "Squad", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(navigation.getByRole("link", { name: "Squad", exact: true }))
      .toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(navigation).toBeVisible();
    expect(await page.evaluate(() => matchMedia("(display-mode: standalone)").matches)).toBe(false);
    await page.evaluate(() => document.fonts.ready);
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expect(navigation).toHaveCSS("padding-bottom", "0px");
      await expect(navigation).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`squad-browser-${viewport.width}.png`) });
    }

    await page.locator('summary[aria-label="Open settings"]').click({ timeout: 5000 });
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(new URL("/", page.url()).href);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    expect(pageErrors).toEqual([]);
  } finally {
    await cleanupFixture(fixture);
  }
});

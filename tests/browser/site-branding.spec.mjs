import { expect, test } from "@playwright/test";

const socialImage = "https://www.pingisliganfantasy.se/branding/pingisligan-fantasy-logo.png";

test("both language roots and account pages advertise branded icons and previews", async ({ page }) => {
  for (const path of ["/", "/en", "/about", "/rules", "/login", "/signup"]) {
    await page.goto(path);

    await expect(page.locator('link[rel="icon"][href="/branding/icon-96.png"]'))
      .toHaveAttribute("sizes", "96x96");
    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]').first()).toBeAttached();
    await expect(page.locator('link[rel="apple-touch-icon"]'))
      .toHaveAttribute("href", "/branding/apple-touch-icon.png");
    const manifest = page.locator('link[rel="manifest"]');
    await expect(manifest).toHaveCount(1);
    await expect(manifest).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]'))
      .toHaveAttribute("content", "PLF");
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'))
      .toHaveAttribute("content", "black");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", socialImage);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", socialImage);

    // Adding fallback previews must preserve the existing indexing boundaries.
    const accountPage = path === "/login" || path === "/signup";
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content", accountPage ? "noindex, nofollow" : "index, follow",
    );
    if (accountPage) {
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
    } else {
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        "content", new URL(path, "https://www.pingisliganfantasy.se").href,
      );
    }
  }
});

test("icon and preview assets are publicly available at their advertised sizes", async ({ request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toContain("application/manifest+json");
  expect(manifestResponse.headers()["set-cookie"]).toBeUndefined();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    id: "/",
    name: "PLF",
    short_name: "PLF",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#01213c",
    background_color: "#0a4d86",
  });
  expect(manifest.icons).toEqual([
    { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/branding/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ]);

  for (const [path, size] of [
    ["/branding/icon-96.png", 96],
    ["/branding/apple-touch-icon.png", 180],
    ["/branding/pingisligan-fantasy-logo.png", 1254],
    ...manifest.icons.map(({ src, sizes }) => [src, Number(sizes.split("x")[0])]),
  ]) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
    const png = await response.body();
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  }

  const favicon = await request.get("/favicon.ico");
  expect(favicon.ok()).toBe(true);
  const ico = await favicon.body();
  expect(ico.readUInt16LE(2)).toBe(1);
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, index) =>
    ico[6 + index * 16] || 256);
  expect(sizes).toEqual([16, 32, 48, 64, 96, 128, 256]);
});

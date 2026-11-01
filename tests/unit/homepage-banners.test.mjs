import assert from "node:assert/strict";
import test from "node:test";
import { buildHomepageCards, defaultHomepageSlideIndex } from "../../lib/homepage-banners.ts";
import { safeBannerUrl } from "../../lib/announcements.ts";

const row = (extra = {}) => ({ id: "gameweek:1", kind: "gameweek", gameweek_number: 1,
  state: "open", is_current: true, title: "The Weekly Smash", description: null,
  sponsor: null, image_path: null, image_alt: null, cta_label: null, cta_url: null, ...extra });

test("default selection uses the current competition, then latest completed, then the first card", () => {
  const rows = [row({ state: "previous", is_current: false }), row(), row({ state: "upcoming", is_current: false })];
  assert.equal(defaultHomepageSlideIndex(rows), 1);
  assert.equal(defaultHomepageSlideIndex(rows.map((r) => ({ ...r, is_current: false }))), 0);
  assert.equal(defaultHomepageSlideIndex([row({ state: "previous", is_current: false }), row({ state: "previous", is_current: false }), row({ state: "revealed", is_current: false })]), 1);
  assert.equal(defaultHomepageSlideIndex([]), 0);
});

test("locked gameweek and season payloads stay generic, while revealed editorial fields survive", () => {
  for (const kind of ["gameweek", "season"]) {
    const secret = row({ kind, state: "upcoming", title: "Secret title", description: "Secret prize",
      sponsor: "Secret partner", image_path: "secret.webp", image_alt: "Secret logo",
      cta_label: "Secret headline", cta_url: "https://example.com/secret" });
    const [card] = buildHomepageCards([secret]);
    assert.equal(card.title, kind === "season" ? "Season Competition" : "The Weekly Smash");
    for (const field of ["description", "sponsor", "image_path", "image_alt", "cta_label", "cta_url"]) assert.equal(card[field], null);
    assert.equal(secret.sponsor, "Secret partner", "Inputs are never modified");
    const [revealed] = buildHomepageCards([{ ...secret, state: "revealed" }]);
    assert.equal(revealed.title, "Secret title");
    assert.equal(revealed.description, "Secret prize");
    assert.equal(revealed.cta_label, "Secret headline");
  }
  assert.equal(buildHomepageCards([row()])[0].gameweekLabel, "GW 1");
  assert.equal(buildHomepageCards([row({ gameweek_number: null })])[0].gameweekLabel, undefined);
});

test("only real publisher-verified HTTPS competition destinations are clickable", () => {
  assert.equal(safeBannerUrl("https://example.com/prize"), "https://example.com/prize");
  for (const value of [null, "/dashboard", "/dashboard/competitions/1", "//evil.invalid", "javascript:alert(1)", "https://user:pass@example.com"]) assert.equal(safeBannerUrl(value), undefined);
});

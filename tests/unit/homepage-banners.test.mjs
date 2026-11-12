import assert from "node:assert/strict";
import test from "node:test";
import { buildHomepageCards, defaultHomepageSlideIndex } from "../../lib/homepage-banners.ts";
import { safeBannerUrl } from "../../lib/announcements.ts";

const row = (extra = {}) => ({ id: "gameweek:1", kind: "gameweek", gameweek_number: 1,
  state: "open", is_current: true, title: "Gameweek 1 competition",
  prize_title: null, teaser: null, sponsor: null, image_path: null, image_alt: null, cta_url: null, ...extra });

test("default selection uses the current competition, then latest completed, then the first card", () => {
  const rows = [row({ state: "previous", is_current: false }), row(), row({ state: "upcoming", is_current: false })];
  assert.equal(defaultHomepageSlideIndex(rows), 1);
  assert.equal(defaultHomepageSlideIndex(rows.map((r) => ({ ...r, is_current: false }))), 0);
  assert.equal(defaultHomepageSlideIndex([row({ state: "previous", is_current: false }), row({ state: "previous", is_current: false }), row({ state: "revealed", is_current: false })]), 1);
  assert.equal(defaultHomepageSlideIndex([]), 0);
});

test("locked gameweek and season payloads stay generic, while revealed editorial fields survive", () => {
  for (const kind of ["gameweek", "season"]) {
    const secret = row({ kind, state: "upcoming", title: "Secret title",
      prize_title: "Secret prize", teaser: "Public teaser", sponsor: "Secret partner", image_path: "secret.webp", image_alt: "Secret logo",
      cta_url: "https://example.com/secret" });
    const [card] = buildHomepageCards([secret]);
    assert.equal(card.title, kind === "season" ? "Season Competition" : "Gameweek 1 competition");
    for (const field of ["prize_title", "sponsor", "image_path", "image_alt"]) assert.equal(card[field], null);
    assert.equal(card.teaser, "Public teaser");
    assert.equal(card.cta_url, kind === "season" ? "/competitions/season" : null);
    assert.equal(secret.sponsor, "Secret partner", "Inputs are never modified");
    const [revealed] = buildHomepageCards([{ ...secret, state: "revealed" }]);
    assert.equal(revealed.title, "Secret title");
  }
  assert.equal(buildHomepageCards([row()])[0].gameweekLabel, undefined);
  assert.equal(buildHomepageCards([row({ gameweek_number: null })])[0].gameweekLabel, undefined);
});

test("competition links accept existing HTTPS destinations and dedicated public routes", () => {
  assert.equal(safeBannerUrl("https://example.com/prize"), "https://example.com/prize");
  for (const value of [null, "/dashboard", "/dashboard/competitions/1", "//evil.invalid", "javascript:alert(1)", "https://user:pass@example.com"]) assert.equal(safeBannerUrl(value), undefined);
});

test("only the previous completed winner leads Home during its exact 48-hour unlock window", () => {
  const winner = { gameweek_id: "1", team_name: "Champions", points: 75 };
  const unlock = Date.parse("2026-11-12T00:00:00Z");
  const previous = { id: "2", unlock_at: new Date(unlock).toISOString() };
  const slides = [row({ state: "previous", is_current: false, winner }),
    row({ id: "gameweek:2", state: "previous", is_current: false, winner }), row({ id: "gameweek:3" })];
  for (const [offset, expected] of [[-1, 2], [0, 1], [48 * 3600000 - 1, 1], [48 * 3600000, 2]]) {
    assert.equal(defaultHomepageSlideIndex(slides, previous, unlock + offset), expected);
  }
  for (const state of ["upcoming", "open", "live", "refreshing"]) {
    assert.equal(defaultHomepageSlideIndex(slides.map((slide, index) => index === 1 ? { ...slide, state } : slide), previous, unlock), 2);
  }
  assert.equal(defaultHomepageSlideIndex(slides.map((slide, index) => index === 1 ? { ...slide, winner: null } : slide), previous, unlock), 2,
    "An older winner cannot inherit the latest completed round's window");
  assert.equal(defaultHomepageSlideIndex(slides, null, unlock), 2);
  assert.equal(defaultHomepageSlideIndex(slides, { ...previous, unlock_at: "invalid" }, unlock), 2);
  assert.equal(buildHomepageCards([row({ state: "upcoming", winner })])[0].winner, null);
});

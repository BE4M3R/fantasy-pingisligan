import assert from "node:assert/strict";
import test from "node:test";
import { matchState, safeStreamUrl } from "../../lib/match-summary.ts";

const now = Date.parse("2026-10-02T17:00:00Z");
const fixture = { status: "scheduled", starts_at: "2026-10-02T18:00:00Z", home_score: 0, away_score: 0 };

test("fixture goes live at its start and finishes at five wins", () => {
  assert.equal(matchState(fixture, now), "Upcoming");
  assert.equal(matchState({ ...fixture, starts_at: null }, now), "Upcoming");
  assert.equal(matchState(fixture, now + 3_599_999), "Upcoming");
  assert.equal(matchState(fixture, now + 3_600_000), "Live");
  assert.equal(matchState(fixture, now + 4_000_000), "Live");
  assert.equal(matchState(fixture, now + 86_400_000), "Live");
  assert.equal(matchState({ ...fixture, status: "IN_PROGRESS" }, now), "Live");
  assert.equal(matchState({ ...fixture, home_score: 1, away_score: 1 }, now), "Live");
  assert.equal(matchState({ ...fixture, status: "SCORED", home_score: 5, away_score: 3 }, now), "Final");
  assert.equal(matchState({ ...fixture, status: "in_progress", home_score: 5, away_score: 3 }, now), "Final");
  assert.equal(matchState({ ...fixture, away_score: 5 }, now), "Final");
  assert.equal(matchState({ ...fixture, status: "in_progress", home_score: 4 }, now), "Live");
  assert.equal(matchState({ ...fixture, status: "in_progress", home_score: 5 }, now), "Final");
  assert.equal(matchState({ ...fixture, home_score: 4, away_score: 4 }, now), "Live");
  assert.equal(matchState({ ...fixture, status: "postponed", home_score: 1 }, now), "Postponed");
  assert.equal(matchState({ ...fixture, status: "cancelled" }, now), "Cancelled");
});

test("elapsed starts stay live across Stockholm midnight until the fixture finishes", () => {
  const lateFixture = { ...fixture, starts_at: "2026-10-02T21:30:00Z" };
  assert.equal(matchState(lateFixture, Date.parse("2026-10-02T21:29:59Z")), "Upcoming");
  assert.equal(matchState(lateFixture, Date.parse("2026-10-02T21:45:00Z")), "Live");
  assert.equal(matchState(lateFixture, Date.parse("2026-10-02T22:00:00Z")), "Live");
  assert.equal(matchState({ ...lateFixture, status: "finished" }, Date.parse("2026-10-02T22:00:00Z")), "Final");
});

test("stream links accept public HTTPS destinations and reject executable or malformed URLs", () => {
  assert.equal(safeStreamUrl("https://www.youtube.com/watch?v=demo"), "https://www.youtube.com/watch?v=demo");
  for (const value of [undefined, "", "javascript:alert(1)", "http://example.com", "/local", "https://user:password@example.com"]) {
    assert.equal(safeStreamUrl(value), null);
  }
});

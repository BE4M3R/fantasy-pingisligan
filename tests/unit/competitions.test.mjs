import assert from "node:assert/strict";
import test from "node:test";
import { competitionStatus, formatPrizeValue, isGameweekId } from "../../lib/competitions.ts";
import { safeBannerUrl } from "../../lib/announcements.ts";

test("public competition links reject malformed input", () => {
  const id = "0c662341-22fd-4ee3-823e-99077ba7e90c";
  assert.equal(isGameweekId(id), true);
  assert.equal(isGameweekId("../private"), false);
  for (const path of ["/competitions/season", "/competitions/gameweek/5", `/competitions/gameweek/${id}`]) assert.equal(safeBannerUrl(path), path);
  for (const path of ["/competitions/season/private", "/competitions/gameweek/invalid", "/competitions//evil"])
    assert.equal(safeBannerUrl(path), undefined);

});

test("approximate prize values use configurable amounts rather than tax thresholds", () => {
  assert.equal(formatPrizeValue(null), undefined);
  assert.equal(formatPrizeValue(undefined), undefined);
  assert.equal(formatPrizeValue("invalid"), undefined);
  assert.match(formatPrizeValue(500), /500/);
  assert.match(formatPrizeValue("16000.00"), /16,000/);
});

test("completed refresh does not imply settled competition results", () => {
  assert.equal(competitionStatus({ state: "previous", gameweek_number: 1 }), "Gameweek ended");
  assert.equal(competitionStatus({ state: "refreshing", gameweek_number: 1 }), "Awaiting results");
  assert.equal(competitionStatus({ state: "live", gameweek_number: 1 }), "In progress");
  assert.equal(competitionStatus({ state: "open", gameweek_number: 1 }), "Open");
  assert.equal(competitionStatus({ state: "upcoming", gameweek_number: 1 }), "Upcoming");
  assert.equal(competitionStatus({ state: "revealed", gameweek_number: null }), "Season competition");
});

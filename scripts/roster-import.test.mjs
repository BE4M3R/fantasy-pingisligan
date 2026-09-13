import assert from "node:assert/strict";
import test from "node:test";
import roster from "../data/sbtf-rosters.json" with { type: "json" };
import { canonicalClubName, getClub } from "../lib/clubs.ts";
import { findExistingClub, getOrCreateClubId } from "./club-identity.mjs";
import {
  buildReconciliationPlan, calculatePlayerPrice, matchRosterPlayer,
  parseRankingRows, selectRosterPlayers,
} from "./import-profixio-players.mjs";

const entry = { name: "Test Player", rankingName: "Test Player", licenseId: "123", birthYear: 2000 };
const ranked = { firstName: "Test", lastName: "Player", profixioPlayerId: "123", birthYear: 2000,
  rankingPoints: 2144, rankingPosition: null, clubName: "Old Club", price: 5000000 };

test("roster controls club membership and includes low-ranked inactive players", () => {
  const selected = selectRosterPlayers([{ club: "Eskilstuna by STIGA", players: [entry] }],
    [ranked, { ...ranked, firstName: "Unlisted", profixioPlayerId: "other", rankingPoints: 2500 }]);
  assert.equal(selected.players.length, 1);
  assert.equal(selected.players[0].clubName, "Eskilstuna by STIGA");
  assert.equal(selected.players[0].rankingPoints, 2144);
});

test("missing known players stop the import instead of shrinking a roster", () => {
  assert.throws(() => selectRosterPlayers([{ club: "Kosta SK", players: [entry] }], []), /partial import/);
});

test("a renewed active license wins over the old inactive license", () => {
  const current = { ...ranked, profixioPlayerId: "new", rankingPosition: 100 };
  assert.equal(matchRosterPlayer(entry, [ranked, current]).profixioPlayerId, "new");
  assert.throws(() => matchRosterPlayer(entry, [current, { ...current, profixioPlayerId: "ambiguous" }]), /Ambiguous/);
});

test("explicit name-order aliases can resolve a newly ranked manual player", () => {
  const manual = { ...entry, rankingName: "Machi Asuka", rankingAliases: ["Asuka Machi"], licenseId: null, birthYear: null };
  const row = { ...ranked, firstName: "Asuka", lastName: "Machi" };
  assert.equal(matchRosterPlayer(manual, [row]), row);
});

test("pricing retains its 2250 floor and world ranking supplement", () => {
  assert.equal(calculatePlayerPrice(2144, null), 5000000);
  assert.equal(calculatePlayerPrice(2250, null), 5000000);
  assert.equal(calculatePlayerPrice(2400, null), 20000000);
  assert.equal(calculatePlayerPrice(2500, 4), 42500000);
});

test("manual players cost 10m, have no invented ranking or license, and keep their UUID", () => {
  const manual = roster.clubs.flatMap((club) => club.players).filter((player) => player.manualPrice);
  assert.deepEqual(manual.map((player) => player.name), ["Fumiya Igarashi", "Machi Asuka"]);
  const { players } = selectRosterPlayers([{ club: "Eskilstuna by STIGA", players: manual }], []);
  for (const source of players) {
    assert.equal(source.price, 10000000);
    assert.equal(source.rankingPoints, null);
    assert.equal(source.profixioPlayerId, null);
    const existing = { id: source.rosterPlayerId, profixio_id: null };
    const state = { players: [existing], identities: [] };
    assert.equal(buildReconciliationPlan([source], state)[0].player.id, existing.id);
    const withRanking = { ...source, profixioPlayerId: "new-license", birthYear: 2000 };
    assert.equal(buildReconciliationPlan([withRanking], state)[0].player.id, existing.id);
    assert.throws(() => buildReconciliationPlan([source], {
      players: [{ ...existing, profixio_id: "known-license" }], identities: [],
    }), /Ranking disappeared/);
  }
});

test("roster lists 53 unique players across seven clubs", () => {
  assert.equal(roster.clubs.length, 7);
  const entries = roster.clubs.flatMap((club) => club.players);
  assert.equal(entries.length, 53);
  assert.equal(new Set(entries.map((player) => player.licenseId ?? player.playerId)).size, 53);
});

test("club aliases resolve exactly without conflating other Eskilstuna clubs", () => {
  assert.equal(canonicalClubName("Lindén BTK Esklistuna*"), "Eskilstuna by STIGA");
  assert.equal(canonicalClubName("Eskilstuna BTK"), "Eskilstuna BTK");
  assert.equal(getClub("Linden BTK Eskilstuna").logo, getClub("Eskilstuna by STIGA").logo);
  assert.equal(findExistingClub([{ id: "original", name: "Linden BTK Eskilstuna" }], "Eskilstuna by STIGA").id, "original");
  assert.throws(() => findExistingClub([
    { id: "a", name: "Linden BTK Eskilstuna" }, { id: "b", name: "Eskilstuna by STIGA" },
  ], "Eskilstuna by STIGA"), /Multiple database clubs/);
});

test("renaming an existing club preserves its ID and never inserts a second club", async () => {
  const calls = [];
  const supabase = { from: () => ({ update: (payload) => ({ eq: async (key, id) => {
    calls.push({ payload, key, id }); return { error: null };
  } }) }) };
  const clubs = [{ id: "original", name: "Linden BTK Eskilstuna" }];
  assert.equal(await getOrCreateClubId(supabase, clubs, "Eskilstuna by STIGA"), "original");
  assert.deepEqual(calls, [{ payload: { name: "Eskilstuna by STIGA" }, key: "id", id: "original" }]);
  assert.equal(await getOrCreateClubId(supabase, clubs, "Linden BTK Eskilstuna"), "original");
  assert.equal(calls.length, 1);
});

test("Profixio inactive placement is unranked, while its points are preserved", () => {
  const rows = parseRankingRows(`<tr><td>0</td><td>(0)</td><td><span class='rml_poeng' id='rml:123:410:0'>Player, Test</span></td><td>2000</td><td>Kosta SK</td><td>2144</td></tr>`);
  assert.equal(rows[0].rankingPosition, null);
  assert.equal(rows[0].rankingPoints, 2144);
  assert.equal(rows[0].price, 5000000);
});

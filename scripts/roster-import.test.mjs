import assert from "node:assert/strict";
import test from "node:test";
import roster from "../data/sbtf-rosters.json" with { type: "json" };
import { canonicalClubName, getClub } from "../lib/clubs.ts";
import { findExistingClub, getOrCreateClubId } from "./club-identity.mjs";
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

test("test fixture club names retain their marker and resolve the shared logo", () => {
  assert.equal(canonicalClubName("[TEST] Linden BTK Eskilstuna"), "[TEST] Eskilstuna by STIGA");
  assert.equal(getClub("[TEST] BTK Rekord").logo, "/club-logos/sbtf-rekord.jpg");
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

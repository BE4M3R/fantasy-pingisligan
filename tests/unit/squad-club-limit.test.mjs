import assert from "node:assert/strict";
import test from "node:test";
import {
  canReplaceClub,
  canTransferFromClub,
  getOverLimitClubIds,
} from "../../lib/squad-club-limit.ts";

const savedSquad = [
  { club: "eskilstuna", position: "starter" },
  { club: "eskilstuna", position: "starter" },
  { club: "kosta", position: "starter" },
  { club: "halmstad", position: "starter" },
  { club: "eskilstuna", position: "bench" },
  { club: "kosta", position: "bench" },
];
const clubIds = savedSquad.map((player) => player.club);

test("a migrated squad counts main and bench together without altering its saved selection", () => {
  const before = structuredClone(savedSquad);
  assert.deepEqual([...getOverLimitClubIds(clubIds)], ["eskilstuna"]);
  assert.deepEqual(savedSquad, before);
  assert.equal(canTransferFromClub(clubIds, savedSquad[4].club), true);
});

test("only players from an over-limit club can be transferred or removed", () => {
  assert.equal(canTransferFromClub(clubIds, "eskilstuna"), true);
  assert.equal(canTransferFromClub(clubIds, "kosta"), false);
  assert.equal(canTransferFromClub(clubIds, "halmstad"), false);
  assert.equal(canTransferFromClub(clubIds, null), false);
  assert.equal(canReplaceClub(clubIds, "halmstad", "rekord"), false);
});

test("a corrective transfer must leave space at the incoming player's club", () => {
  assert.equal(canReplaceClub(clubIds, "eskilstuna", "eskilstuna"), false);
  assert.equal(canReplaceClub(clubIds, "eskilstuna", "kosta"), false);
  assert.equal(canReplaceClub(clubIds, "eskilstuna", "halmstad"), true);
  assert.equal(canReplaceClub(clubIds, "eskilstuna", "rekord"), true);
});

test("normal transfers resume after correcting the extra bench player", () => {
  const corrected = clubIds.map((id, index) => index === 4 ? "rekord" : id);
  assert.equal(getOverLimitClubIds(corrected).size, 0);
  assert.equal(canTransferFromClub(corrected, "halmstad"), true);
  assert.equal(canReplaceClub(corrected, "kosta", "kosta"), true);
  assert.equal(canReplaceClub(corrected, "halmstad", "eskilstuna"), false);
  assert.equal(canReplaceClub(corrected, "halmstad", "rekord"), true);
});

test("correction remains required until every over-limit club has been repaired", () => {
  const twoClubs = ["a", "a", "a", "b", "b", "b"];
  assert.equal(getOverLimitClubIds(twoClubs).size, 2);
  const partial = ["a", "a", "c", "b", "b", "b"];
  assert.deepEqual([...getOverLimitClubIds(partial)], ["b"]);
  assert.equal(canTransferFromClub(partial, "a"), false);
  assert.equal(canTransferFromClub(partial, "b"), true);
  assert.equal(getOverLimitClubIds(["a", "a", "c", "b", "b", "d"]).size, 0);
});

test("unassigned clubs are not treated as one club", () => {
  assert.equal(getOverLimitClubIds([null, null, null, "a", "a"]).size, 0);
});

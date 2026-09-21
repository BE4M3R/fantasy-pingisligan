import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canSelectPlayer, hasConfiguredPrice, comparePlayerPrices } from "../lib/player-availability.ts";

test("active players with null rankings are selectable at their configured price", () => {
  const player = { active: true, price: 10000000, ranking_points: null, ranking_position: null };
  assert.equal(canSelectPlayer(player), true);
  assert.equal(canSelectPlayer({ ...player, active: false }), false);
  for (const price of [null, undefined, "", " ", 0, -1, Infinity, NaN, "invalid", true, 1.5]) {
    assert.equal(hasConfiguredPrice(price), false);
    assert.equal(canSelectPlayer({ ...player, price }), false);
  }
  assert.equal(canSelectPlayer({ ...player, price: "10000000" }), true);
});

test("price sorting ignores rankings and leaves invalid prices last in either direction", () => {
  const players = [{ price: 10, ranking_points: null }, { price: 5, ranking_points: 9999 }, { price: null }];
  assert.deepEqual(players.toSorted((a, b) => comparePlayerPrices(a, b, true)).map((p) => p.price), [5, 10, null]);
  assert.deepEqual(players.toSorted(comparePlayerPrices).map((p) => p.price), [10, 5, null]);
});

test("picker, API and all selection actions have no ranking eligibility gate", async () => {
  for (const file of ["app/dashboard/player-picker.tsx", "app/dashboard/actions.ts", "app/api/players/route.ts"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /ranking_points|ranking_position|No ranking/);
    if (!file.includes("api/")) assert.match(source, /canSelectPlayer/);
  }
});

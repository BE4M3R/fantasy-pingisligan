import assert from "node:assert/strict";
import test from "node:test";
import { calculatePlayerPrice, parsePriceArguments } from "./calculate-player-price.mjs";

test("manual price calculator preserves the former fantasy price formula", () => {
  assert.deepEqual(calculatePlayerPrice(2114), {
    rankingPoints: 2114,
    worldRankingPosition: null,
    rankingComponent: 5000000,
    worldRankingComponent: 0,
    price: 5000000,
  });
  assert.deepEqual(calculatePlayerPrice(2305, 98), {
    rankingPoints: 2305,
    worldRankingPosition: 98,
    rankingComponent: 10500000,
    worldRankingComponent: 2525381,
    price: 13025381,
  });
});

test("manual price inputs must be explicit positive whole numbers", () => {
  assert.deepEqual(parsePriceArguments([
    "--ranking-points", "2305", "--world-ranking-position", "98",
  ]), { rankingPoints: "2305", worldRankingPosition: "98" });
  for (const value of [undefined, null, "", 0, -1, 2.5, "invalid"]) {
    assert.throws(() => calculatePlayerPrice(value), /Ranking points/);
  }
  assert.throws(() => calculatePlayerPrice(2305, 0), /World-ranking position/);
  assert.throws(() => parsePriceArguments(["--rank", "2305"]), /Unknown argument/);
  assert.throws(() => parsePriceArguments(["--ranking-points"]), /Missing value/);
});

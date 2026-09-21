import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_RANKING_POINTS = 2250;
export const PRICE_OFFSET = 2200;
export const PRICE_MULTIPLIER = 100000;
export const WORLD_RANK_PRICE_POOL = 25000000;

function positiveInteger(value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return number;
}

export function calculatePlayerPrice(rankingPointsInput, worldRankingPositionInput = null) {
  const rankingPoints = positiveInteger(rankingPointsInput, "Ranking points");
  const worldRankingPosition = positiveInteger(
    worldRankingPositionInput,
    "World-ranking position",
    { optional: true },
  );
  const rankingComponent =
    (Math.max(MIN_RANKING_POINTS, rankingPoints) - PRICE_OFFSET) *
    PRICE_MULTIPLIER;
  const worldRankingComponent = worldRankingPosition
    ? Math.round(WORLD_RANK_PRICE_POOL / Math.sqrt(worldRankingPosition))
    : 0;

  return {
    rankingPoints,
    worldRankingPosition,
    rankingComponent,
    worldRankingComponent,
    price: rankingComponent + worldRankingComponent,
  };
}

export function parsePriceArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!["--ranking-points", "--world-ranking-position"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}.`);
    }
    if (argument === "--ranking-points") values.rankingPoints = value;
    if (argument === "--world-ranking-position") values.worldRankingPosition = value;
    index += 1;
  }
  return values;
}

function usage() {
  return [
    "Usage:",
    "  npm run calculate:player-price -- --ranking-points <points> [--world-ranking-position <position>]",
    "",
    "The command is offline and read-only. Copy the returned price into the player's catalogue entry.",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }
  const { rankingPoints, worldRankingPosition } = parsePriceArguments(args);
  if (rankingPoints === undefined) throw new Error(`Missing --ranking-points.\n\n${usage()}`);
  const result = calculatePlayerPrice(rankingPoints, worldRankingPosition);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

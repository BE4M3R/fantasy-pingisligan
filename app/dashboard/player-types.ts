export type DashboardPlayer = {
  active?: boolean;
  id: string;
  first_name: string;
  last_name: string;
  birth_year: number | null;
  price: number | string;
  clubs: { id: string; name: string } | { id: string; name: string }[] | null;
};

export type SquadPosition = "starter" | "bench";

export type SquadPlayerOption = DashboardPlayer & {
  position: SquadPosition;
};

export type DraftSquadPlayer = SquadPlayerOption & {
  is_captain: boolean;
};

export type SquadPlayerResult = DraftSquadPlayer & {
  active_chip: "wildcard" | "triple_captain" | "bench_boost" | null;
  automatic_substitution: "in" | "out" | null;
  captain_bonus_points: number;
  counts_for_team: boolean;
  doubles_losses: number;
  doubles_set_points: number;
  doubles_sets_lost: number;
  doubles_sets_won: number;
  doubles_wins: number;
  fantasy_points: number;
  fixture_win_points: number;
  gameweek_id: string;
  gameweek_name: string;
  match_win_points: number;
  original_position: SquadPosition;
  round_order: number | null;
  set_points: number;
  set_breakdown_available: boolean;
  sets_lost: number;
  sets_won: number;
  singles_losses: number;
  singles_set_points: number;
  singles_sets_lost: number;
  singles_sets_won: number;
  singles_wins: number;
  sweep_bonus_points: number;
  team_points_contribution: number;
};

export function hasPlayedMatch(result: SquadPlayerResult) {
  return (
    result.singles_wins +
      result.singles_losses +
      result.doubles_wins +
      result.doubles_losses >
    0
  );
}

export function getDisplayedResultPoints(result: SquadPlayerResult) {
  return result.original_position === "bench" && !result.counts_for_team
    ? result.fantasy_points
    : result.team_points_contribution;
}

export function applyAutomaticBenchSubstitutions(
  results: SquadPlayerResult[],
) {
  const starters = results.filter(
    (result) => result.original_position === "starter",
  );
  const bench = results.filter(
    (result) => result.original_position === "bench",
  );
  const missingStarterIndexes = starters.flatMap((result, index) =>
    hasPlayedMatch(result) ? [] : [index],
  );
  const playingBenchIndexes = bench.flatMap((result, index) =>
    hasPlayedMatch(result) ? [index] : [],
  );
  const substitutionCount = Math.min(
    missingStarterIndexes.length,
    playingBenchIndexes.length,
  );
  const effectiveStarters = [...starters];
  const effectiveBench = [...bench];

  for (let index = 0; index < substitutionCount; index += 1) {
    const starterIndex = missingStarterIndexes[index];
    const benchIndex = playingBenchIndexes[index];
    const missingStarter = effectiveStarters[starterIndex];
    const playingBenchPlayer = effectiveBench[benchIndex];

    effectiveStarters[starterIndex] = {
      ...playingBenchPlayer,
      automatic_substitution: "in",
      position: "starter",
    };
    effectiveBench[benchIndex] = {
      ...missingStarter,
      automatic_substitution: "out",
      position: "bench",
    };
  }

  return [...effectiveStarters, ...effectiveBench].map((result) => {
    const playedMatch = hasPlayedMatch(result);
    const countsForTeam =
      result.active_chip === "bench_boost" ||
      (result.original_position === "starter" && playedMatch) ||
      result.automatic_substitution === "in";
    const captainMultiplier =
      result.is_captain &&
      result.original_position === "starter" &&
      playedMatch
        ? result.active_chip === "triple_captain"
          ? 3
          : 2
        : 1;

    return {
      ...result,
      captain_bonus_points:
        countsForTeam && captainMultiplier > 1
          ? result.fantasy_points * (captainMultiplier - 1)
          : 0,
      counts_for_team: countsForTeam,
      team_points_contribution: countsForTeam
        ? result.fantasy_points * captainMultiplier
        : 0,
    };
  });
}

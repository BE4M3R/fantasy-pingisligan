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
  captain_bonus_points: number;
  counts_for_team: boolean;
  doubles_losses: number;
  doubles_wins: number;
  fantasy_points: number;
  fixture_win_points: number;
  gameweek_id: string;
  gameweek_name: string;
  match_win_points: number;
  round_order: number | null;
  set_points: number;
  sets_lost: number;
  sets_won: number;
  singles_losses: number;
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
  return result.counts_for_team
    ? result.team_points_contribution
    : result.fantasy_points;
}

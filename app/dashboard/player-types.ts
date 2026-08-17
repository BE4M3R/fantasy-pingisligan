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

import "server-only";

import {
  applyAutomaticBenchSubstitutions,
  type SquadPlayerResult,
  type SquadPosition,
} from "@/app/dashboard/player-types";

export type SquadResultRow = {
  active_chip: "wildcard" | "triple_captain" | "bench_boost" | null;
  captain_bonus_points: number | string;
  club_id: string | null;
  club_name: string | null;
  counts_for_team: boolean;
  doubles_losses: number | string;
  doubles_wins: number | string;
  fantasy_points: number | string;
  fixture_win_points: number | string;
  gameweek_id: string;
  gameweek_name: string;
  is_captain: boolean;
  last_name: string;
  match_win_points: number | string;
  player_id: string;
  position: SquadPosition;
  price: number | string;
  round_order: number | null;
  set_points: number | string;
  sets_lost: number | string;
  sets_won: number | string;
  singles_losses: number | string;
  singles_wins: number | string;
  first_name: string;
  sweep_bonus_points: number | string;
  team_points_contribution: number | string;
};

export type SquadSetBreakdownRow = {
  doubles_set_points: number | string;
  doubles_sets_lost: number | string;
  doubles_sets_won: number | string;
  player_id: string;
  singles_set_points: number | string;
  singles_sets_lost: number | string;
  singles_sets_won: number | string;
};

function getSquadResultPlayer(
  row: SquadResultRow,
  setBreakdown?: SquadSetBreakdownRow,
): SquadPlayerResult {
  return {
    active_chip: row.active_chip,
    automatic_substitution: null,
    birth_year: null,
    captain_bonus_points: Number(row.captain_bonus_points),
    clubs: row.club_name
      ? { id: row.club_id ?? "", name: row.club_name }
      : null,
    counts_for_team: row.counts_for_team,
    doubles_losses: Number(row.doubles_losses),
    doubles_set_points: Number(setBreakdown?.doubles_set_points ?? 0),
    doubles_sets_lost: Number(setBreakdown?.doubles_sets_lost ?? 0),
    doubles_sets_won: Number(setBreakdown?.doubles_sets_won ?? 0),
    doubles_wins: Number(row.doubles_wins),
    fantasy_points: Number(row.fantasy_points),
    first_name: row.first_name,
    fixture_win_points: Number(row.fixture_win_points),
    gameweek_id: row.gameweek_id,
    gameweek_name: row.gameweek_name,
    id: row.player_id,
    is_captain: row.is_captain,
    last_name: row.last_name,
    match_win_points: Number(row.match_win_points),
    original_position: row.position,
    position: row.position,
    price: row.price,
    round_order: row.round_order,
    set_points: Number(row.set_points),
    set_breakdown_available: Boolean(setBreakdown),
    sets_lost: Number(row.sets_lost),
    sets_won: Number(row.sets_won),
    singles_losses: Number(row.singles_losses),
    singles_set_points: Number(setBreakdown?.singles_set_points ?? 0),
    singles_sets_lost: Number(setBreakdown?.singles_sets_lost ?? 0),
    singles_sets_won: Number(setBreakdown?.singles_sets_won ?? 0),
    singles_wins: Number(row.singles_wins),
    sweep_bonus_points: Number(row.sweep_bonus_points),
    team_points_contribution: Number(row.team_points_contribution),
  };
}

export function buildSquadResult(
  resultRows: SquadResultRow[],
  setBreakdownRows: SquadSetBreakdownRow[],
) {
  const setBreakdownByPlayer = new Map(
    setBreakdownRows.map((row) => [row.player_id, row]),
  );

  return applyAutomaticBenchSubstitutions(
    resultRows.map((row) =>
      getSquadResultPlayer(row, setBreakdownByPlayer.get(row.player_id)),
    ),
  );
}

export type PlayerStatisticsWeek = {
  player_id: string;
  gameweek_id: string;
  gameweek_name: string;
  round_order: number | null;
  starts_at: string;
  is_final: boolean;
  fantasy_points: number;
  singles_wins: number;
  singles_losses: number;
  doubles_wins: number;
  doubles_losses: number;
  singles_sets_won: number;
  singles_sets_lost: number;
  singles_set_points: number;
  singles_won_match_sets_won: number;
  singles_won_match_sets_lost: number;
  singles_won_match_set_points: number;
  singles_lost_match_sets_won: number;
  singles_lost_match_sets_lost: number;
  singles_lost_match_set_points: number;
};

export type PlayerStatisticsSummary = {
  total_points: number;
  form: number | null;
  owned_percent: number | null;
  singles_wins: number;
  singles_losses: number;
};

export function winRate(wins: number, losses: number) {
  return wins + losses > 0 ? Math.round(100 * wins / (wins + losses)) : null;
}

export function formatOwnership(value: number | null) {
  return value == null ? "—" : `${Number(value).toFixed(1).replace(/\.0$/, "")}%`;
}

export function hasPlayerAppearance(week: Pick<PlayerStatisticsWeek, "singles_wins" | "singles_losses" | "doubles_wins" | "doubles_losses">) {
  return week.singles_wins + week.singles_losses + week.doubles_wins + week.doubles_losses > 0;
}

export function summarizePlayerWeeks(weeks: PlayerStatisticsWeek[]) {
  const totals = weeks.reduce((sum, week) => ({
    points: sum.points + week.fantasy_points,
    singlesWins: sum.singlesWins + week.singles_wins,
    singlesLosses: sum.singlesLosses + week.singles_losses,
    doublesWins: sum.doublesWins + week.doubles_wins,
    doublesLosses: sum.doublesLosses + week.doubles_losses,
    setsWon: sum.setsWon + week.singles_sets_won,
    setsLost: sum.setsLost + week.singles_sets_lost,
    setPoints: sum.setPoints + week.singles_set_points,
    wonMatchSetsWon: sum.wonMatchSetsWon + week.singles_won_match_sets_won,
    wonMatchSetsLost: sum.wonMatchSetsLost + week.singles_won_match_sets_lost,
    wonMatchSetPoints: sum.wonMatchSetPoints + week.singles_won_match_set_points,
    lostMatchSetsWon: sum.lostMatchSetsWon + week.singles_lost_match_sets_won,
    lostMatchSetsLost: sum.lostMatchSetsLost + week.singles_lost_match_sets_lost,
    lostMatchSetPoints: sum.lostMatchSetPoints + week.singles_lost_match_set_points,
    appearances: sum.appearances + Number(hasPlayerAppearance(week)),
  }), { points: 0, singlesWins: 0, singlesLosses: 0, doublesWins: 0, doublesLosses: 0, setsWon: 0, setsLost: 0, setPoints: 0, wonMatchSetsWon: 0, wonMatchSetsLost: 0, wonMatchSetPoints: 0, lostMatchSetsWon: 0, lostMatchSetsLost: 0, lostMatchSetPoints: 0, appearances: 0 });
  return totals;
}

export function gameweekLabel(week: { round_order: number | null; gameweek_name: string }) {
  return week.round_order !== null ? `GW ${week.round_order}` : week.gameweek_name;
}

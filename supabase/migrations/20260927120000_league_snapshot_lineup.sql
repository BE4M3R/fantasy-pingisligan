-- Let signed-in players inspect the locked lineup for a visible league result.
-- Keep the snapshot tables private; this function exposes only display fields.
create function public.get_leaderboard_team_gameweek_lineup(
  p_user_id uuid,
  p_gameweek_id uuid
)
returns table (
  player_id uuid,
  first_name text,
  last_name text,
  club_name text,
  "position" text,
  is_captain boolean,
  lineup_order integer,
  fantasy_points integer,
  has_played boolean,
  active_chip text,
  transfer_penalty_points integer
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    players.player_id,
    players.player_first_name_at_lock,
    players.player_last_name_at_lock,
    players.club_name_at_lock,
    players.position,
    players.is_captain,
    players.lineup_order::integer,
    coalesce(players.fantasy_points, 0),
    exists (
      select 1
      from public.player_match_stats as stats
      join public.matches as matches on matches.id = stats.match_id
      where matches.fantasy_gameweek_id = p_gameweek_id
        and stats.player_id = players.player_id
        and stats.won_matches + stats.lost_matches > 0
    ),
    snapshots.active_chip,
    snapshots.transfer_penalty_points
  from public.fantasy_teams as teams
  join public.fantasy_team_gameweek_snapshots as snapshots
    on snapshots.fantasy_team_id = teams.id
    and snapshots.fantasy_gameweek_id = p_gameweek_id
  join public.fantasy_gameweeks as gameweeks
    on gameweeks.id = snapshots.fantasy_gameweek_id
    and public.gameweek_results_are_visible(gameweeks.first_match_starts_at)
  join public.fantasy_team_gameweek_players as players
    on players.fantasy_team_id = snapshots.fantasy_team_id
    and players.fantasy_gameweek_id = snapshots.fantasy_gameweek_id
  where auth.uid() is not null
    and teams.user_id = p_user_id
    and teams.onboarding_completed
  order by players.lineup_order, players.player_id;
$$;

revoke all on function public.get_leaderboard_team_gameweek_lineup(uuid, uuid)
from public;
grant execute on function public.get_leaderboard_team_gameweek_lineup(uuid, uuid)
to authenticated;

-- Read one locked player's scoring components after league results become visible.
-- Keep the same set, fixture and clincher rules as the scoring and own-result RPCs.
create function public.get_league_player_score_breakdown(
  p_user_id uuid,
  p_gameweek_id uuid,
  p_player_id uuid
)
returns table (
  player_id uuid,
  singles_wins integer,
  singles_losses integer,
  doubles_wins integer,
  doubles_losses integer,
  singles_sets_won integer,
  singles_sets_lost integer,
  singles_set_points integer,
  fixture_win_points integer,
  clinching_bonus_points integer,
  sweep_bonus_points integer
)
language sql
security definer
set search_path = ''
stable
as $$
  with selected_snapshot as (
    select
      snapshots.fantasy_team_id,
      snapshots.fantasy_gameweek_id,
      snapshot_players.player_id
    from public.fantasy_teams as teams
    join public.fantasy_team_gameweek_snapshots as snapshots
      on snapshots.fantasy_team_id = teams.id
      and snapshots.fantasy_gameweek_id = p_gameweek_id
    join public.fantasy_gameweeks as gameweeks
      on gameweeks.id = snapshots.fantasy_gameweek_id
      and public.gameweek_results_are_visible(gameweeks.first_match_starts_at)
    join public.fantasy_team_gameweek_players as snapshot_players
      on snapshot_players.fantasy_team_id = snapshots.fantasy_team_id
      and snapshot_players.fantasy_gameweek_id = snapshots.fantasy_gameweek_id
      and snapshot_players.player_id = p_player_id
    where auth.uid() is not null
      and teams.user_id = p_user_id
      and teams.onboarding_completed
  ),
  side_sizes as (
    select
      results.stupa_submatch_id,
      results.team_stupa_participant_id,
      count(*)::integer as player_count
    from public.player_submatch_results as results
    join public.stupa_submatches as submatches
      on submatches.stupa_submatch_id = results.stupa_submatch_id
    join public.matches as matches
      on matches.id = submatches.match_id
    join selected_snapshot
      on selected_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
    group by results.stupa_submatch_id, results.team_stupa_participant_id
  ),
  submatch_context as (
    select
      submatches.stupa_submatch_id,
      submatches.match_id,
      submatches.match_order,
      submatches.is_golden_match,
      bool_or(side_sizes.player_count > 1) as is_doubles,
      bool_or(
        results.walkover
        or nullif(results.raw_payload #>> '{side,walkover_reason}', '') is not null
      ) as is_walkover
    from public.stupa_submatches as submatches
    join public.matches as matches
      on matches.id = submatches.match_id
    join selected_snapshot
      on selected_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
    join public.player_submatch_results as results
      on results.stupa_submatch_id = submatches.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where upper(submatches.status) = 'SCORED'
    group by submatches.stupa_submatch_id, submatches.match_id,
      submatches.match_order, submatches.is_golden_match
  ),
  result_components as (
    select
      context.match_id,
      context.stupa_submatch_id,
      context.match_order,
      context.is_doubles,
      context.is_walkover,
      results.player_id,
      results.team_stupa_participant_id,
      results.won,
      case
        when context.is_walkover and results.won then 3
        when context.is_walkover then 0
        else results.sets_won
      end as sets_won,
      case when context.is_walkover then 0 else results.sets_lost end as sets_lost,
      case
        when context.is_doubles then 0
        when context.is_walkover then case when results.won then 3 else 0 end
        when results.won then greatest(results.sets_won - results.sets_lost, 0)
        else results.sets_won
      end as set_points
    from submatch_context as context
    join public.player_submatch_results as results
      on results.stupa_submatch_id = context.stupa_submatch_id
    where results.player_id = p_player_id
  ),
  result_totals as (
    select
      player_id,
      count(*) filter (where not is_doubles and won)::integer as singles_wins,
      count(*) filter (where not is_doubles and not won)::integer as singles_losses,
      count(*) filter (where is_doubles and won)::integer as doubles_wins,
      count(*) filter (where is_doubles and not won)::integer as doubles_losses,
      coalesce(sum(sets_won) filter (where not is_doubles), 0)::integer as singles_sets_won,
      coalesce(sum(sets_lost) filter (where not is_doubles), 0)::integer as singles_sets_lost,
      coalesce(sum(set_points), 0)::integer as singles_set_points
    from result_components
    group by player_id
  ),
  sweep_bonuses as (
    select player_id, 2::integer as sweep_bonus_points
    from result_components
    where not is_doubles
    group by player_id
    having count(*) >= 2 and bool_and(won)
  ),
  winning_clubs as (
    select
      matches.id as match_id,
      case
        when lower(matches.status) = 'scored'
          and matches.winning_team_stupa_participant_id =
          matches.home_team_stupa_participant_id then matches.home_club_id
        when lower(matches.status) = 'scored'
          and matches.winning_team_stupa_participant_id =
          matches.away_team_stupa_participant_id then matches.away_club_id
      end as club_id
    from public.matches as matches
    join selected_snapshot
      on selected_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
  ),
  fixture_participants as (
    select distinct match_id, player_id
    from result_components
  ),
  fixture_bonuses as (
    select
      fixture_participants.player_id,
      (count(*) * 3)::integer as fixture_win_points
    from fixture_participants
    join winning_clubs
      on winning_clubs.match_id = fixture_participants.match_id
    join public.player_gameweek_club_snapshots as roster
      on roster.fantasy_gameweek_id = p_gameweek_id
      and roster.player_id = fixture_participants.player_id
      and roster.club_id_at_lock = winning_clubs.club_id
    group by fixture_participants.player_id
  ),
  final_submatches as (
    select distinct on (context.match_id)
      context.match_id,
      context.stupa_submatch_id,
      context.is_doubles
    from submatch_context as context
    order by context.match_id, context.is_golden_match desc,
      context.match_order desc nulls last, context.stupa_submatch_id desc
  ),
  clinching_bonuses as (
    select
      final_submatches.match_id,
      result_components.player_id,
      case when final_submatches.is_doubles then 1 else 2 end as points
    from final_submatches
    join public.matches as matches
      on matches.id = final_submatches.match_id
    join result_components
      on result_components.stupa_submatch_id = final_submatches.stupa_submatch_id
    where lower(matches.status) = 'scored'
      and result_components.won
      and result_components.team_stupa_participant_id =
        matches.winning_team_stupa_participant_id
  ),
  clinching_totals as (
    select player_id, sum(points)::integer as clinching_bonus_points
    from clinching_bonuses
    group by player_id
  )
  select
    selected_snapshot.player_id,
    coalesce(result_totals.singles_wins, 0)::integer,
    coalesce(result_totals.singles_losses, 0)::integer,
    coalesce(result_totals.doubles_wins, 0)::integer,
    coalesce(result_totals.doubles_losses, 0)::integer,
    coalesce(result_totals.singles_sets_won, 0)::integer,
    coalesce(result_totals.singles_sets_lost, 0)::integer,
    coalesce(result_totals.singles_set_points, 0)::integer,
    coalesce(fixture_bonuses.fixture_win_points, 0)::integer,
    coalesce(clinching_totals.clinching_bonus_points, 0)::integer,
    coalesce(sweep_bonuses.sweep_bonus_points, 0)::integer
  from selected_snapshot
  left join result_totals on result_totals.player_id = selected_snapshot.player_id
  left join fixture_bonuses on fixture_bonuses.player_id = selected_snapshot.player_id
  left join clinching_totals on clinching_totals.player_id = selected_snapshot.player_id
  left join sweep_bonuses on sweep_bonuses.player_id = selected_snapshot.player_id;
$$;

revoke all on function public.get_league_player_score_breakdown(uuid, uuid, uuid)
from public;
grant execute on function public.get_league_player_score_breakdown(uuid, uuid, uuid)
to authenticated;

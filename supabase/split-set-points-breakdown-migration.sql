-- Expose singles and doubles set scoring separately in squad result mode.

begin;

create or replace function public.get_my_latest_squad_set_breakdown()
returns table (
  player_id uuid,
  singles_sets_won integer,
  singles_sets_lost integer,
  singles_set_points integer,
  doubles_sets_won integer,
  doubles_sets_lost integer,
  doubles_set_points integer
)
language sql
security definer
set search_path = ''
stable
as $$
  with latest_snapshot as (
    select
      snapshots.fantasy_team_id,
      snapshots.fantasy_gameweek_id
    from public.fantasy_team_gameweek_snapshots as snapshots
    join public.fantasy_teams as teams
      on teams.id = snapshots.fantasy_team_id
      and teams.user_id = auth.uid()
    join public.fantasy_gameweeks as gameweeks
      on gameweeks.id = snapshots.fantasy_gameweek_id
    order by
      gameweeks.round_order desc nulls last,
      gameweeks.lock_at desc,
      gameweeks.id
    limit 1
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
    join latest_snapshot
      on latest_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
    group by results.stupa_submatch_id, results.team_stupa_participant_id
  ),
  result_components as (
    select
      results.player_id,
      bool_or(side_sizes.player_count > 1) over (
        partition by results.stupa_submatch_id
      ) as is_doubles,
      case
        when bool_or(
          results.walkover
          or nullif(results.raw_payload #>> '{side,walkover_reason}', '') is not null
        ) over (partition by results.stupa_submatch_id)
          and results.won then 3
        when bool_or(
          results.walkover
          or nullif(results.raw_payload #>> '{side,walkover_reason}', '') is not null
        ) over (partition by results.stupa_submatch_id) then 0
        else results.sets_won
      end as sets_won,
      case
        when bool_or(
          results.walkover
          or nullif(results.raw_payload #>> '{side,walkover_reason}', '') is not null
        ) over (partition by results.stupa_submatch_id) then 0
        else results.sets_lost
      end as sets_lost,
      side_sizes.player_count
    from public.player_submatch_results as results
    join public.stupa_submatches as submatches
      on submatches.stupa_submatch_id = results.stupa_submatch_id
      and upper(submatches.status) = 'SCORED'
    join public.matches as matches
      on matches.id = submatches.match_id
    join latest_snapshot
      on latest_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where results.player_id is not null
  ),
  result_totals as (
    select
      result_components.player_id,
      coalesce(
        sum(result_components.sets_won) filter (
          where not result_components.is_doubles
        ),
        0
      )::integer as singles_sets_won,
      coalesce(
        sum(result_components.sets_lost) filter (
          where not result_components.is_doubles
        ),
        0
      )::integer as singles_sets_lost,
      coalesce(
        sum(result_components.sets_won) filter (
          where not result_components.is_doubles
        ),
        0
      )::integer as singles_set_points,
      coalesce(
        sum(result_components.sets_won) filter (
          where result_components.is_doubles
        ),
        0
      )::integer as doubles_sets_won,
      coalesce(
        sum(result_components.sets_lost) filter (
          where result_components.is_doubles
        ),
        0
      )::integer as doubles_sets_lost,
      coalesce(
        sum(
          ceil(
            result_components.sets_won::numeric /
              result_components.player_count
          )::integer
        ) filter (where result_components.is_doubles),
        0
      )::integer as doubles_set_points
    from result_components
    group by result_components.player_id
  )
  select
    snapshot_players.player_id,
    coalesce(result_totals.singles_sets_won, 0)::integer,
    coalesce(result_totals.singles_sets_lost, 0)::integer,
    coalesce(result_totals.singles_set_points, 0)::integer,
    coalesce(result_totals.doubles_sets_won, 0)::integer,
    coalesce(result_totals.doubles_sets_lost, 0)::integer,
    coalesce(result_totals.doubles_set_points, 0)::integer
  from latest_snapshot
  join public.fantasy_team_gameweek_players as snapshot_players
    on snapshot_players.fantasy_team_id = latest_snapshot.fantasy_team_id
    and snapshot_players.fantasy_gameweek_id = latest_snapshot.fantasy_gameweek_id
  left join result_totals on result_totals.player_id = snapshot_players.player_id
  order by snapshot_players.player_id;
$$;

revoke all on function public.get_my_latest_squad_set_breakdown() from public;
grant execute on function public.get_my_latest_squad_set_breakdown()
to authenticated;

commit;

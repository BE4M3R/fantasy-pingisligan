-- Calculate fantasy points from imported Stupa results and recalculate safely.

alter table public.matches
  add column if not exists home_team_stupa_participant_id integer,
  add column if not exists away_team_stupa_participant_id integer,
  add column if not exists winning_team_stupa_participant_id integer;

create or replace function public.calculate_player_match_stats(target_gameweek_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_stat_count integer;
begin
  delete from public.player_match_stats
  using public.matches
  where matches.id = player_match_stats.match_id
    and matches.fantasy_gameweek_id = target_gameweek_id;

  with side_sizes as (
    select
      results.stupa_submatch_id,
      results.team_stupa_participant_id,
      count(*)::integer as player_count
    from public.player_submatch_results as results
    group by results.stupa_submatch_id, results.team_stupa_participant_id
  ),
  submatch_context as (
    select
      submatches.stupa_submatch_id,
      submatches.match_id,
      bool_or(side_sizes.player_count > 1) as is_doubles,
      bool_or(
        results.walkover
        or nullif(results.raw_payload #>> '{side,walkover_reason}', '') is not null
      ) as is_walkover
    from public.stupa_submatches as submatches
    join public.matches
      on matches.id = submatches.match_id
      and matches.fantasy_gameweek_id = target_gameweek_id
    join public.player_submatch_results as results
      on results.stupa_submatch_id = submatches.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where upper(submatches.status) = 'SCORED'
    group by submatches.stupa_submatch_id, submatches.match_id
  ),
  result_points as (
    select
      context.match_id,
      results.player_id,
      context.is_doubles,
      results.won,
      case
        when context.is_walkover and results.won then 3
        when context.is_walkover then 0
        else results.sets_won
      end as won_sets,
      case
        when context.is_walkover then 0
        else results.sets_lost
      end as lost_sets,
      case
        when context.is_doubles then
          (case when results.won then 2 else 0 end)
          + ceil(
              (
                case
                  when context.is_walkover and results.won then 3
                  when context.is_walkover then 0
                  else results.sets_won
                end
                - case when context.is_walkover then 0 else results.sets_lost end
              )::numeric / side_sizes.player_count
            )::integer
        when context.is_walkover then case when results.won then 7 else 0 end
        else
          (case when results.won then 4 else 0 end)
          + results.sets_won
          - results.sets_lost
      end as points
    from submatch_context as context
    join public.player_submatch_results as results
      on results.stupa_submatch_id = context.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where results.player_id is not null
  ),
  result_totals as (
    select
      match_id,
      player_id,
      count(*) filter (where won)::integer as won_matches,
      count(*) filter (where not won)::integer as lost_matches,
      sum(won_sets)::integer as won_sets,
      sum(lost_sets)::integer as lost_sets,
      sum(points)::integer as points
    from result_points
    group by match_id, player_id
  ),
  singles_bonus as (
    select
      result_points.player_id,
      min(result_points.match_id::text)::uuid as bonus_match_id
    from result_points
    where not result_points.is_doubles
    group by result_points.player_id
    having count(*) >= 2 and bool_and(result_points.won)
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
    from public.matches
    where matches.fantasy_gameweek_id = target_gameweek_id
  ),
  match_players as (
    select result_totals.match_id, result_totals.player_id
    from result_totals
    union
    select winning_clubs.match_id, players.id
    from winning_clubs
    join public.players
      on players.club_id = winning_clubs.club_id
    where winning_clubs.club_id is not null
  )
  insert into public.player_match_stats (
    match_id,
    player_id,
    won_matches,
    lost_matches,
    won_sets,
    lost_sets,
    fantasy_points
  )
  select
    match_players.match_id,
    match_players.player_id,
    coalesce(result_totals.won_matches, 0),
    coalesce(result_totals.lost_matches, 0),
    coalesce(result_totals.won_sets, 0),
    coalesce(result_totals.lost_sets, 0),
    coalesce(result_totals.points, 0)
      + case when winning_clubs.club_id = players.club_id then 3 else 0 end
      + case when singles_bonus.bonus_match_id = match_players.match_id then 2 else 0 end
  from match_players
  join public.players
    on players.id = match_players.player_id
  left join result_totals
    on result_totals.match_id = match_players.match_id
    and result_totals.player_id = match_players.player_id
  left join winning_clubs
    on winning_clubs.match_id = match_players.match_id
  left join singles_bonus
    on singles_bonus.player_id = match_players.player_id;

  get diagnostics inserted_stat_count = row_count;
  return inserted_stat_count;
end;
$$;

revoke all on function public.calculate_player_match_stats(uuid) from public;
grant execute on function public.calculate_player_match_stats(uuid) to service_role;

create or replace function public.calculate_fantasy_gameweek_points(target_gameweek_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_team_count integer;
begin
  perform public.calculate_player_match_stats(target_gameweek_id);

  update public.fantasy_team_gameweek_players
  set fantasy_points = 0
  where fantasy_gameweek_id = target_gameweek_id;

  with player_points as (
    select
      matches.fantasy_gameweek_id,
      player_match_stats.player_id,
      sum(player_match_stats.fantasy_points)::integer as points
    from public.player_match_stats
    join public.matches
      on matches.id = player_match_stats.match_id
    where matches.fantasy_gameweek_id = target_gameweek_id
    group by matches.fantasy_gameweek_id, player_match_stats.player_id
  )
  update public.fantasy_team_gameweek_players as snapshot_players
  set fantasy_points = player_points.points
  from player_points
  where snapshot_players.fantasy_gameweek_id = player_points.fantasy_gameweek_id
    and snapshot_players.player_id = player_points.player_id;

  insert into public.fantasy_team_gameweek_points (
    fantasy_team_id,
    fantasy_gameweek_id,
    points,
    calculated_at,
    updated_at
  )
  select
    snapshots.fantasy_team_id,
    snapshots.fantasy_gameweek_id,
    (
      coalesce(
        sum(
          case
            when snapshot_players.position = 'bench'
              and snapshots.active_chip is distinct from 'bench_boost' then 0
            when snapshot_players.is_captain
              and snapshot_players.position = 'starter'
              and snapshots.active_chip = 'triple_captain'
              then coalesce(snapshot_players.fantasy_points, 0) * 3
            when snapshot_players.is_captain
              and snapshot_players.position = 'starter'
              then coalesce(snapshot_players.fantasy_points, 0) * 2
            else coalesce(snapshot_players.fantasy_points, 0)
          end
        ),
        0
      ) + snapshots.transfer_penalty_points
    )::integer as points,
    now(),
    now()
  from public.fantasy_team_gameweek_snapshots as snapshots
  left join public.fantasy_team_gameweek_players as snapshot_players
    on snapshot_players.fantasy_team_id = snapshots.fantasy_team_id
    and snapshot_players.fantasy_gameweek_id = snapshots.fantasy_gameweek_id
  where snapshots.fantasy_gameweek_id = target_gameweek_id
  group by
    snapshots.fantasy_team_id,
    snapshots.fantasy_gameweek_id,
    snapshots.active_chip,
    snapshots.transfer_penalty_points
  on conflict (fantasy_team_id, fantasy_gameweek_id) do update
  set points = excluded.points,
      calculated_at = excluded.calculated_at,
      updated_at = excluded.updated_at;

  get diagnostics updated_team_count = row_count;
  return updated_team_count;
end;
$$;

revoke all on function public.calculate_fantasy_gameweek_points(uuid) from public;
grant execute on function public.calculate_fantasy_gameweek_points(uuid) to service_role;

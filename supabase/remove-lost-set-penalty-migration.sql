-- Stop deducting fantasy points for sets lost.

begin;

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
      case when context.is_walkover then 0 else results.sets_lost end as lost_sets,
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
              )::numeric / side_sizes.player_count
            )::integer
        when context.is_walkover then case when results.won then 7 else 0 end
        else
          (case when results.won then 4 else 0 end)
          + results.sets_won
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
    join public.players on players.club_id = winning_clubs.club_id
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
  join public.players on players.id = match_players.player_id
  left join result_totals
    on result_totals.match_id = match_players.match_id
    and result_totals.player_id = match_players.player_id
  left join winning_clubs on winning_clubs.match_id = match_players.match_id
  left join singles_bonus on singles_bonus.player_id = match_players.player_id;

  get diagnostics inserted_stat_count = row_count;
  return inserted_stat_count;
end;
$$;

revoke all on function public.calculate_player_match_stats(uuid) from public;
grant execute on function public.calculate_player_match_stats(uuid) to service_role;

create or replace function public.get_my_latest_squad_result()
returns table (
  gameweek_id uuid,
  gameweek_name text,
  round_order integer,
  active_chip text,
  player_id uuid,
  first_name text,
  last_name text,
  club_id uuid,
  club_name text,
  price numeric,
  "position" text,
  is_captain boolean,
  fantasy_points integer,
  singles_wins integer,
  singles_losses integer,
  doubles_wins integer,
  doubles_losses integer,
  sets_won integer,
  sets_lost integer,
  match_win_points integer,
  set_points integer,
  fixture_win_points integer,
  sweep_bonus_points integer,
  captain_bonus_points integer,
  counts_for_team boolean,
  team_points_contribution integer
)
language sql
security definer
set search_path = ''
stable
as $$
  with latest_snapshot as (
    select
      snapshots.fantasy_team_id,
      snapshots.fantasy_gameweek_id,
      snapshots.active_chip,
      gameweeks.name as gameweek_name,
      gameweeks.round_order,
      gameweeks.lock_at
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
  submatch_context as (
    select
      submatches.stupa_submatch_id,
      bool_or(side_sizes.player_count > 1) as is_doubles,
      bool_or(
        results.walkover
        or nullif(results.raw_payload #>> '{side,walkover_reason}', '') is not null
      ) as is_walkover
    from public.stupa_submatches as submatches
    join public.matches as matches
      on matches.id = submatches.match_id
    join latest_snapshot
      on latest_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
    join public.player_submatch_results as results
      on results.stupa_submatch_id = submatches.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where upper(submatches.status) = 'SCORED'
    group by submatches.stupa_submatch_id
  ),
  result_components as (
    select
      results.player_id,
      context.is_doubles,
      results.won,
      case
        when context.is_walkover and results.won then 3
        when context.is_walkover then 0
        else results.sets_won
      end as sets_won,
      case when context.is_walkover then 0 else results.sets_lost end as sets_lost,
      case
        when results.won and context.is_doubles then 2
        when results.won then 4
        else 0
      end as match_win_points,
      case
        when context.is_doubles then
          ceil(
            (
              case
                when context.is_walkover and results.won then 3
                when context.is_walkover then 0
                else results.sets_won
              end
            )::numeric / side_sizes.player_count
          )::integer
        when context.is_walkover and results.won then 3
        when context.is_walkover then 0
        else results.sets_won
      end as set_points
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
      player_id,
      count(*) filter (where not is_doubles and won)::integer as singles_wins,
      count(*) filter (where not is_doubles and not won)::integer as singles_losses,
      count(*) filter (where is_doubles and won)::integer as doubles_wins,
      count(*) filter (where is_doubles and not won)::integer as doubles_losses,
      sum(sets_won)::integer as sets_won,
      sum(sets_lost)::integer as sets_lost,
      sum(match_win_points)::integer as match_win_points,
      sum(set_points)::integer as set_points
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
  fixture_bonuses as (
    select
      snapshot_players.player_id,
      (count(*) * 3)::integer as fixture_win_points
    from latest_snapshot
    join public.fantasy_team_gameweek_players as snapshot_players
      on snapshot_players.fantasy_team_id = latest_snapshot.fantasy_team_id
      and snapshot_players.fantasy_gameweek_id = latest_snapshot.fantasy_gameweek_id
    join public.players
      on players.id = snapshot_players.player_id
    join public.matches
      on matches.fantasy_gameweek_id = latest_snapshot.fantasy_gameweek_id
      and lower(matches.status) = 'scored'
      and (
        (
          matches.winning_team_stupa_participant_id = matches.home_team_stupa_participant_id
          and matches.home_club_id = players.club_id
        )
        or (
          matches.winning_team_stupa_participant_id = matches.away_team_stupa_participant_id
          and matches.away_club_id = players.club_id
        )
      )
    group by snapshot_players.player_id
  ),
  player_scores as (
    select
      latest_snapshot.fantasy_team_id,
      latest_snapshot.fantasy_gameweek_id,
      latest_snapshot.active_chip,
      latest_snapshot.gameweek_name,
      latest_snapshot.round_order,
      snapshot_players.player_id,
      snapshot_players.player_first_name_at_lock,
      snapshot_players.player_last_name_at_lock,
      snapshot_players.club_id_at_lock,
      snapshot_players.club_name_at_lock,
      snapshot_players.price_at_lock,
      snapshot_players.position,
      snapshot_players.is_captain,
      coalesce(snapshot_players.fantasy_points, 0)::integer as fantasy_points,
      coalesce(result_totals.singles_wins, 0)::integer as singles_wins,
      coalesce(result_totals.singles_losses, 0)::integer as singles_losses,
      coalesce(result_totals.doubles_wins, 0)::integer as doubles_wins,
      coalesce(result_totals.doubles_losses, 0)::integer as doubles_losses,
      coalesce(result_totals.sets_won, 0)::integer as sets_won,
      coalesce(result_totals.sets_lost, 0)::integer as sets_lost,
      coalesce(result_totals.match_win_points, 0)::integer as match_win_points,
      coalesce(result_totals.set_points, 0)::integer as set_points,
      coalesce(fixture_bonuses.fixture_win_points, 0)::integer as fixture_win_points,
      coalesce(sweep_bonuses.sweep_bonus_points, 0)::integer as sweep_bonus_points
    from latest_snapshot
    join public.fantasy_team_gameweek_players as snapshot_players
      on snapshot_players.fantasy_team_id = latest_snapshot.fantasy_team_id
      and snapshot_players.fantasy_gameweek_id = latest_snapshot.fantasy_gameweek_id
    left join result_totals on result_totals.player_id = snapshot_players.player_id
    left join fixture_bonuses on fixture_bonuses.player_id = snapshot_players.player_id
    left join sweep_bonuses on sweep_bonuses.player_id = snapshot_players.player_id
  )
  select
    player_scores.fantasy_gameweek_id,
    player_scores.gameweek_name,
    player_scores.round_order,
    player_scores.active_chip,
    player_scores.player_id,
    player_scores.player_first_name_at_lock,
    player_scores.player_last_name_at_lock,
    player_scores.club_id_at_lock,
    player_scores.club_name_at_lock,
    player_scores.price_at_lock,
    player_scores.position,
    player_scores.is_captain,
    player_scores.fantasy_points,
    player_scores.singles_wins,
    player_scores.singles_losses,
    player_scores.doubles_wins,
    player_scores.doubles_losses,
    player_scores.sets_won,
    player_scores.sets_lost,
    player_scores.match_win_points,
    player_scores.set_points,
    player_scores.fixture_win_points,
    player_scores.sweep_bonus_points,
    case
      when player_scores.is_captain
        and player_scores.position = 'starter'
        and player_scores.active_chip = 'triple_captain'
        then player_scores.fantasy_points * 2
      when player_scores.is_captain and player_scores.position = 'starter'
        then player_scores.fantasy_points
      else 0
    end::integer as captain_bonus_points,
    (
      player_scores.position = 'starter'
      or player_scores.active_chip = 'bench_boost'
    ) as counts_for_team,
    case
      when player_scores.position = 'bench'
        and player_scores.active_chip is distinct from 'bench_boost' then 0
      when player_scores.is_captain
        and player_scores.position = 'starter'
        and player_scores.active_chip = 'triple_captain'
        then player_scores.fantasy_points * 3
      when player_scores.is_captain and player_scores.position = 'starter'
        then player_scores.fantasy_points * 2
      else player_scores.fantasy_points
    end::integer as team_points_contribution
  from player_scores
  order by
    case when player_scores.position = 'starter' then 0 else 1 end,
    player_scores.player_last_name_at_lock,
    player_scores.player_first_name_at_lock,
    player_scores.player_id;
$$;

revoke all on function public.get_my_latest_squad_result() from public;
grant execute on function public.get_my_latest_squad_result() to authenticated;

commit;

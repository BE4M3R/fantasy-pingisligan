begin;

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
              - case when context.is_walkover then 0 else results.sets_lost end
            )::numeric / side_sizes.player_count
          )::integer
        when context.is_walkover and results.won then 3
        when context.is_walkover then 0
        else results.sets_won - results.sets_lost
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

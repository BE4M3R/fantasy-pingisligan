-- A golden doubles match is played after the regular fixture even though its
-- STUPA order restarts at one. Only the winner of the actual final scored
-- submatch can earn the fixture clincher bonus.
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
      submatches.match_order,
      submatches.is_golden_match,
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
    group by submatches.stupa_submatch_id, submatches.match_id,
      submatches.match_order, submatches.is_golden_match
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
        when context.is_doubles then case when results.won then 2 else 0 end
        when context.is_walkover then case when results.won then 7 else 0 end
        else
          (case when results.won then 4 else 0 end)
          + case
              when results.won then greatest(results.sets_won - results.sets_lost, 0)
              else results.sets_won
            end
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
  final_submatches as (
    select distinct on (context.match_id)
      context.match_id,
      context.stupa_submatch_id,
      context.is_doubles
    from submatch_context as context
    order by context.match_id, context.is_golden_match desc,
      context.match_order desc nulls last, context.stupa_submatch_id desc
  ),
  clinching_bonus as (
    select
      final_submatches.match_id,
      results.player_id,
      case when final_submatches.is_doubles then 1 else 2 end as points
    from final_submatches
    join public.matches
      on matches.id = final_submatches.match_id
    join public.player_submatch_results as results
      on results.stupa_submatch_id = final_submatches.stupa_submatch_id
    where lower(matches.status) = 'scored'
      and results.won
      and results.team_stupa_participant_id = matches.winning_team_stupa_participant_id
      and results.player_id is not null
  ),
  gameweek_roster as (
    select
      roster.player_id,
      roster.club_id_at_lock
    from public.player_gameweek_club_snapshots as roster
    where roster.fantasy_gameweek_id = target_gameweek_id
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
    result_totals.match_id,
    result_totals.player_id,
    result_totals.won_matches,
    result_totals.lost_matches,
    result_totals.won_sets,
    result_totals.lost_sets,
    result_totals.points
      + case
          when winning_clubs.club_id = gameweek_roster.club_id_at_lock then 3
          else 0
        end
      + case
          when singles_bonus.bonus_match_id = result_totals.match_id then 2
          else 0
        end
      + coalesce(clinching_bonus.points, 0)
  from result_totals
  left join winning_clubs on winning_clubs.match_id = result_totals.match_id
  left join gameweek_roster on gameweek_roster.player_id = result_totals.player_id
  left join singles_bonus on singles_bonus.player_id = result_totals.player_id
  left join clinching_bonus
    on clinching_bonus.match_id = result_totals.match_id
    and clinching_bonus.player_id = result_totals.player_id;

  get diagnostics inserted_stat_count = row_count;
  return inserted_stat_count;
end;
$$;

revoke all on function public.calculate_player_match_stats(uuid) from public;
grant execute on function public.calculate_player_match_stats(uuid) to service_role;

-- Make the squad result breakdown select that same final scored submatch.
create or replace function public.get_my_squad_score_breakdown(target_gameweek_id uuid)
returns table (
  player_id uuid,
  singles_sets_won integer,
  singles_sets_lost integer,
  singles_set_points integer,
  fixture_win_points integer,
  clinching_bonus_points integer
)
language sql
security definer
set search_path = ''
stable
as $$
  with selected_snapshot as (
    select
      snapshots.fantasy_team_id,
      snapshots.fantasy_gameweek_id
    from public.fantasy_team_gameweek_snapshots as snapshots
    join public.fantasy_teams as teams
      on teams.id = snapshots.fantasy_team_id
      and teams.user_id = auth.uid()
    where snapshots.fantasy_gameweek_id = target_gameweek_id
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
    where results.player_id is not null
  ),
  result_totals as (
    select
      player_id,
      coalesce(sum(sets_won) filter (where not is_doubles), 0)::integer as singles_sets_won,
      coalesce(sum(sets_lost) filter (where not is_doubles), 0)::integer as singles_sets_lost,
      coalesce(sum(set_points), 0)::integer as singles_set_points
    from result_components
    group by player_id
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
      on roster.fantasy_gameweek_id = target_gameweek_id
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
    snapshot_players.player_id,
    coalesce(result_totals.singles_sets_won, 0)::integer,
    coalesce(result_totals.singles_sets_lost, 0)::integer,
    coalesce(result_totals.singles_set_points, 0)::integer,
    coalesce(fixture_bonuses.fixture_win_points, 0)::integer,
    coalesce(clinching_totals.clinching_bonus_points, 0)::integer
  from selected_snapshot
  join public.fantasy_team_gameweek_players as snapshot_players
    on snapshot_players.fantasy_team_id = selected_snapshot.fantasy_team_id
    and snapshot_players.fantasy_gameweek_id = selected_snapshot.fantasy_gameweek_id
  left join result_totals on result_totals.player_id = snapshot_players.player_id
  left join fixture_bonuses on fixture_bonuses.player_id = snapshot_players.player_id
  left join clinching_totals on clinching_totals.player_id = snapshot_players.player_id
  order by snapshot_players.player_id;
$$;

revoke all on function public.get_my_squad_score_breakdown(uuid) from public;
grant execute on function public.get_my_squad_score_breakdown(uuid) to authenticated;


-- Correct persisted player and locked-team points for previously scored
-- gameweeks, including Gameweek 1, using their stored results and snapshots.
-- It does not change locked lineups or transfer history.
do $$
declare
  gameweek record;
  locked_team_count integer;
  scored_team_count integer;
begin
  for gameweek in
    select gameweeks.id
    from public.fantasy_gameweeks as gameweeks
    where exists (
      select 1
      from public.matches as matches
      join public.stupa_submatches as submatches
        on submatches.match_id = matches.id
      where matches.fantasy_gameweek_id = gameweeks.id
        and upper(submatches.status) = 'SCORED'
    )
    order by gameweeks.id
  loop
    select count(*) into locked_team_count
    from public.fantasy_team_gameweek_snapshots as snapshots
    where snapshots.fantasy_gameweek_id = gameweek.id;

    if exists (
      select 1
      from public.fantasy_team_gameweek_points as points
      where points.fantasy_gameweek_id = gameweek.id
        and not exists (
          select 1
          from public.fantasy_team_gameweek_snapshots as snapshots
          where snapshots.fantasy_gameweek_id = points.fantasy_gameweek_id
            and snapshots.fantasy_team_id = points.fantasy_team_id
        )
    ) then
      raise exception 'Cannot rescore gameweek %: a scored team has no locked snapshot', gameweek.id;
    end if;

    scored_team_count := public.calculate_fantasy_gameweek_points(gameweek.id);
    if scored_team_count <> locked_team_count then
      raise exception 'Gameweek %: rescored % teams but found % locked snapshots',
        gameweek.id, scored_team_count, locked_team_count;
    end if;

    raise notice 'Rescored gameweek % for % locked teams', gameweek.id, scored_team_count;
  end loop;
end;
$$;

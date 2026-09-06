-- Automatically replace non-playing starters with playing bench players.
-- Bench priority is the same deterministic name order used in result mode.

begin;

create or replace function public.calculate_fantasy_gameweek_points(
  target_gameweek_id uuid
)
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
  set fantasy_points = coalesce(player_points.points, 0)
  from player_points
  where snapshot_players.fantasy_gameweek_id = player_points.fantasy_gameweek_id
    and snapshot_players.player_id = player_points.player_id;

  with player_appearances as (
    select
      matches.fantasy_gameweek_id,
      player_match_stats.player_id,
      bool_or(
        player_match_stats.won_matches + player_match_stats.lost_matches > 0
      ) as played
    from public.player_match_stats
    join public.matches
      on matches.id = player_match_stats.match_id
    where matches.fantasy_gameweek_id = target_gameweek_id
    group by matches.fantasy_gameweek_id, player_match_stats.player_id
  ),
  lineup as (
    select
      snapshots.fantasy_team_id,
      snapshots.fantasy_gameweek_id,
      snapshots.active_chip,
      snapshots.transfer_penalty_points,
      snapshot_players.player_id,
      snapshot_players.position,
      snapshot_players.is_captain,
      snapshot_players.player_first_name_at_lock,
      snapshot_players.player_last_name_at_lock,
      coalesce(snapshot_players.fantasy_points, 0)::integer as fantasy_points,
      coalesce(player_appearances.played, false) as played
    from public.fantasy_team_gameweek_snapshots as snapshots
    left join public.fantasy_team_gameweek_players as snapshot_players
      on snapshot_players.fantasy_team_id = snapshots.fantasy_team_id
      and snapshot_players.fantasy_gameweek_id = snapshots.fantasy_gameweek_id
    left join player_appearances
      on player_appearances.fantasy_gameweek_id =
        snapshot_players.fantasy_gameweek_id
      and player_appearances.player_id = snapshot_players.player_id
    where snapshots.fantasy_gameweek_id = target_gameweek_id
  ),
  ranked_lineup as (
    select
      lineup.*,
      count(*) filter (
        where lineup.position = 'starter' and not lineup.played
      ) over (
        partition by lineup.fantasy_team_id, lineup.fantasy_gameweek_id
      ) as missing_starter_count,
      count(*) filter (
        where lineup.position = 'bench' and lineup.played
      ) over (
        partition by lineup.fantasy_team_id, lineup.fantasy_gameweek_id
        order by
          lineup.player_last_name_at_lock,
          lineup.player_first_name_at_lock,
          lineup.player_id
        rows between unbounded preceding and current row
      ) as playing_bench_rank
    from lineup
  ),
  scored_lineup as (
    select
      ranked_lineup.*,
      case
        when ranked_lineup.active_chip = 'bench_boost' then true
        when ranked_lineup.position = 'starter' then ranked_lineup.played
        when ranked_lineup.position = 'bench' and ranked_lineup.played
          then ranked_lineup.playing_bench_rank <=
            ranked_lineup.missing_starter_count
        else false
      end as counts_for_team
    from ranked_lineup
  )
  insert into public.fantasy_team_gameweek_points (
    fantasy_team_id,
    fantasy_gameweek_id,
    points,
    calculated_at,
    updated_at
  )
  select
    scored_lineup.fantasy_team_id,
    scored_lineup.fantasy_gameweek_id,
    (
      coalesce(
        sum(
          case
            when not scored_lineup.counts_for_team then 0
            when scored_lineup.is_captain
              and scored_lineup.position = 'starter'
              and scored_lineup.played
              and scored_lineup.active_chip = 'triple_captain'
              then scored_lineup.fantasy_points * 3
            when scored_lineup.is_captain
              and scored_lineup.position = 'starter'
              and scored_lineup.played
              then scored_lineup.fantasy_points * 2
            else scored_lineup.fantasy_points
          end
        ),
        0
      ) + scored_lineup.transfer_penalty_points
    )::integer as points,
    now(),
    now()
  from scored_lineup
  group by
    scored_lineup.fantasy_team_id,
    scored_lineup.fantasy_gameweek_id,
    scored_lineup.active_chip,
    scored_lineup.transfer_penalty_points
  on conflict (fantasy_team_id, fantasy_gameweek_id) do update
  set points = excluded.points,
      calculated_at = excluded.calculated_at,
      updated_at = excluded.updated_at;

  get diagnostics updated_team_count = row_count;

  return updated_team_count;
end;
$$;

revoke all on function public.calculate_fantasy_gameweek_points(uuid)
from public;
grant execute on function public.calculate_fantasy_gameweek_points(uuid)
to service_role;

commit;

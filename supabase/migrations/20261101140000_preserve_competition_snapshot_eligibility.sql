begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- snapshot_locked_squads validates entry against the deadline when capturing
-- the squad. Preserve that decision: the local lifecycle simulates elapsed
-- time by moving Gameweek boundaries after capture. Rechecking team creation
-- against that moved deadline would hide valid snapshots after local unlock.
-- The immutable snapshot time remains a useful integrity bound in every target.
create or replace function private.weekly_competition_entries(p_gameweek_id uuid)
returns table (team_id uuid, team_name text, points integer, captain_raw_points integer,
  calculated_at timestamptz, score_ready boolean)
language sql stable security invoker set search_path = ''
as $$
  with valid as (
    select s.fantasy_team_id, s.team_name_at_lock, s.snapshotted_at
    from public.fantasy_team_gameweek_snapshots s
    join public.fantasy_gameweeks g on g.id = s.fantasy_gameweek_id
    join public.fantasy_teams t on t.id = s.fantasy_team_id and t.created_at <= s.snapshotted_at
    join public.fantasy_team_gameweek_players p
      on p.fantasy_team_id = s.fantasy_team_id and p.fantasy_gameweek_id = s.fantasy_gameweek_id
    where s.fantasy_gameweek_id = p_gameweek_id and g.lock_at <= now()
    group by s.fantasy_team_id, s.team_name_at_lock, s.snapshotted_at
    having count(*) = 6
      and count(*) filter (where p.position = 'starter') = 4
      and count(*) filter (where p.position = 'bench') = 2
      and count(*) filter (where p.is_captain) = 1
      and count(*) filter (where p.is_captain and p.position = 'starter') = 1
      and count(distinct p.lineup_order) = 6
  ), appearances as materialized (
    select stats.player_id, bool_or(stats.won_matches + stats.lost_matches > 0) as played
    from public.player_match_stats stats join public.matches m on m.id = stats.match_id
    where m.fantasy_gameweek_id = p_gameweek_id group by stats.player_id
  ), lineup as (
    select p.*, coalesce(a.played, false) as played
    from valid v join public.fantasy_team_gameweek_players p
      on p.fantasy_team_id = v.fantasy_team_id and p.fantasy_gameweek_id = p_gameweek_id
    left join appearances a on a.player_id = p.player_id
  ), ordered as (
    select l.*,
      count(*) filter (where l.position = 'starter' and not l.played)
        over (partition by l.fantasy_team_id order by l.lineup_order rows unbounded preceding) as absent_rank,
      count(*) filter (where l.position = 'bench' and l.played)
        over (partition by l.fantasy_team_id order by l.lineup_order rows unbounded preceding) as bench_rank
    from lineup l
  )
  select v.fantasy_team_id, v.team_name_at_lock, pts.points,
    case when captain.played then coalesce(captain.fantasy_points, 0)
      else coalesce(replacement.fantasy_points, 0) end,
    pts.calculated_at,
    pts.points is not null and pts.calculated_at >= v.snapshotted_at
      and not exists (select 1 from lineup l where l.fantasy_team_id = v.fantasy_team_id and l.fantasy_points is null)
  from valid v
  join ordered captain on captain.fantasy_team_id = v.fantasy_team_id and captain.is_captain
  left join ordered replacement on replacement.fantasy_team_id = v.fantasy_team_id
    and not captain.played and replacement.position = 'bench' and replacement.played
    and replacement.bench_rank = captain.absent_rank
  left join public.fantasy_team_gameweek_points pts
    on pts.fantasy_team_id = v.fantasy_team_id and pts.fantasy_gameweek_id = p_gameweek_id;
$$;
revoke all on function private.weekly_competition_entries(uuid) from public, anon, authenticated, service_role;
commit;

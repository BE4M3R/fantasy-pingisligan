begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Shared read projection, never another scoring system. Scores come verbatim
-- from Fantasy. Only captain identity is derived using the scorer's ordered
-- pairing of absent starters and playing bench players.
create function private.weekly_competition_entries(p_gameweek_id uuid)
returns table (team_id uuid, team_name text, points integer, captain_raw_points integer,
  calculated_at timestamptz, score_ready boolean)
language sql stable security invoker set search_path = ''
as $$
  with valid as (
    select s.fantasy_team_id, s.team_name_at_lock, s.snapshotted_at
    from public.fantasy_team_gameweek_snapshots s
    join public.fantasy_gameweeks g on g.id = s.fantasy_gameweek_id
    join public.fantasy_teams t on t.id = s.fantasy_team_id and t.created_at <= g.lock_at
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

-- Public projection deliberately excludes account/team IDs, profile names,
-- captain details, squads, and private operator review information.
create function public.get_competition_standings(p_gameweek_id uuid default null,
  p_offset integer default 0, p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if p_gameweek_id is null then
    with ranked as materialized (
      select t.team_name, t.total_points as points, t.user_id,
        rank() over (order by t.total_points desc) as rank
      from public.get_global_leaderboard() t
    )
    select jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object(
      'rank', r.rank, 'team_name', r.team_name, 'points', r.points) order by r.rank, lower(r.team_name), r.user_id)
      from (select * from ranked order by rank, lower(team_name), user_id
        limit least(greatest(coalesce(p_limit, 25), 1), 50) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb),
      'total_count', (select count(*) from ranked), 'visible', true, 'refreshed', false,
      'missing_scores', 0, 'fixture_count', 0, 'outstanding_fixtures', 0)
    into result;
    return result;
  end if;

  if not exists (select 1 from public.fantasy_gameweeks g where g.id = p_gameweek_id
    and public.gameweek_results_are_visible(g.first_match_starts_at)) then
    return jsonb_build_object('rows', '[]'::jsonb, 'total_count', 0, 'visible', false,
      'refreshed', false, 'missing_scores', 0, 'fixture_count', 0, 'outstanding_fixtures', 0);
  end if;

  with entries as materialized (select * from private.weekly_competition_entries(p_gameweek_id)),
  ranked as (
    select e.*, rank() over (order by e.points desc) as rank from entries e where e.score_ready
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object(
    'rank', r.rank, 'team_name', r.team_name, 'points', r.points) order by r.rank, lower(r.team_name), r.team_id)
    from (select * from ranked order by rank, lower(team_name), team_id
      limit least(greatest(coalesce(p_limit, 25), 1), 50) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb),
    'total_count', (select count(*) from ranked), 'visible', true,
    'refreshed', (select g.data_refreshed_at is not null from public.fantasy_gameweeks g where g.id = p_gameweek_id),
    'missing_scores', (select count(*) from entries where not score_ready),
    'fixture_count', (select count(*) from public.matches m where m.fantasy_gameweek_id = p_gameweek_id),
    'outstanding_fixtures', (select count(*) from public.matches m where m.fantasy_gameweek_id = p_gameweek_id and lower(m.status) <> 'scored'))
  into result;
  return result;
end;
$$;
revoke all on function public.get_competition_standings(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_competition_standings(uuid, integer, integer) to anon, authenticated, service_role;

-- Read-only operator diagnostics. No confirmation table, draw execution, prize
-- award, or announcement publishing is introduced in Phases 1 and 2.
create function public.get_weekly_competition_review(p_gameweek_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with entries as materialized (select * from private.weekly_competition_entries(p_gameweek_id)),
  summary as (
    select count(*) as entries, count(*) filter (where not score_ready) as missing_scores,
      max(points) filter (where score_ready) as top_points,
      min(calculated_at) filter (where score_ready) as oldest_score_at,
      max(calculated_at) filter (where score_ready) as latest_score_at from entries
  ), leaders as (
    select e.* from entries e cross join summary s
    where s.missing_scores = 0 and e.score_ready and e.points = s.top_points
      and exists (select 1 from public.fantasy_gameweeks g where g.id = p_gameweek_id
        and public.gameweek_results_are_visible(g.first_match_starts_at))
  ), finalists as (
    select * from leaders where captain_raw_points = (select max(captain_raw_points) from leaders)
  ), fixtures as (
    select count(*) as total, count(*) filter (where lower(m.status) <> 'scored') as outstanding
    from public.matches m where m.fantasy_gameweek_id = p_gameweek_id
  )
  select jsonb_build_object('gameweek_id', g.id, 'award_enabled', false,
    'status', case
      when not public.gameweek_results_are_visible(g.first_match_starts_at) then 'not_started'
      when s.entries = 0 then 'no_entries'
      when s.missing_scores > 0 then 'incomplete_scores'
      when f.total = 0 or f.outstanding > 0 then 'awaiting_results'
      when g.data_refreshed_at is null then 'awaiting_refresh'
      when (select count(*) from finalists) > 1 then 'draw_required'
      else 'provisional_leader' end,
    'entry_count', s.entries, 'missing_scores', s.missing_scores,
    'fixture_count', f.total, 'outstanding_fixtures', f.outstanding,
    'data_refreshed_at', g.data_refreshed_at, 'oldest_score_at', s.oldest_score_at,
    'latest_score_at', s.latest_score_at,
    'tied_leaders', coalesce((select jsonb_agg(jsonb_build_object('team_id', l.team_id,
      'team_name', l.team_name, 'points', l.points, 'captain_raw_points', l.captain_raw_points)
      order by l.team_id) from leaders l), '[]'::jsonb),
    'prize_candidates', coalesce((select jsonb_agg(jsonb_build_object('team_id', c.team_id,
      'team_name', c.team_name, 'points', c.points, 'captain_raw_points', c.captain_raw_points)
      order by c.team_id) from finalists c), '[]'::jsonb),
    'draw_required', (select count(*) from finalists) > 1)
  from public.fantasy_gameweeks g cross join summary s cross join fixtures f where g.id = p_gameweek_id;
$$;
revoke all on function public.get_weekly_competition_review(uuid) from public, anon, authenticated;
grant execute on function public.get_weekly_competition_review(uuid) to service_role;

commit;

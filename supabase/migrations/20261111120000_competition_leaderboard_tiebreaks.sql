begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Rank the canonical scored squads. Captain points are already raw and follow
-- automatic substitution. Season totals stop at this round's deadline so later
-- Gameweeks cannot change an older competition's order. Corrections to scores
-- within that period still apply. A complete tie deliberately shares a rank.
create function private.weekly_competition_rankings(p_gameweek_id uuid)
returns table (team_id uuid, team_name text, points integer, captain_raw_points integer,
  calculated_at timestamptz, score_ready boolean, season_points bigint, competition_rank bigint)
language sql stable security invoker set search_path = '' as $$
  with entries as materialized (
    select * from private.weekly_competition_entries(p_gameweek_id)
  ), season_totals as (
    select p.fantasy_team_id, sum(p.points)::bigint as points
    from public.fantasy_team_gameweek_points p
    join entries e on e.team_id = p.fantasy_team_id
    join public.fantasy_gameweeks g on g.id = p.fantasy_gameweek_id
    join public.fantasy_gameweeks target on target.id = p_gameweek_id
    where g.lock_at <= target.lock_at
      and public.gameweek_results_are_visible(g.first_match_starts_at)
    group by p.fantasy_team_id
  )
  select e.*, coalesce(s.points, 0),
    case when e.score_ready then rank() over (partition by e.score_ready
      order by e.points desc, e.captain_raw_points desc, coalesce(s.points, 0) desc) end
  from entries e left join season_totals s on s.fantasy_team_id = e.team_id;
$$;
revoke all on function private.weekly_competition_rankings(uuid) from public, anon, authenticated, service_role;

create or replace function public.get_competition_standings(p_gameweek_id uuid default null,
  p_offset integer default 0, p_limit integer default 25, p_search text default '')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.competitions_enabled() then
    raise exception 'Competition feature is unavailable.' using errcode = '42501';
  end if;
  if p_gameweek_id is not null and not exists (select 1 from public.competition_publication p
    where p.gameweek_id = p_gameweek_id and p.enabled) then
    raise exception 'This Gameweek has no prize competition.' using errcode = '42501';
  end if;
  if p_gameweek_id is null and not public.season_competition_enabled() then
    raise exception 'Season competition is unavailable.' using errcode = '42501';
  end if;
  if p_gameweek_id is null then
    with ranked as materialized (
      select t.team_name, t.total_points as points, t.user_id,
        rank() over (order by t.total_points desc) as rank
      from public.get_global_leaderboard() t
    )
    select jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object(
      'rank', r.rank, 'team_name', r.team_name, 'points', r.points) order by r.rank, lower(r.team_name), r.user_id)
      from (select * from ranked where strpos(lower(team_name), lower(btrim(coalesce(p_search, '')))) > 0 order by rank, lower(team_name), user_id
        limit least(greatest(coalesce(p_limit, 25), 1), 50) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb),
      'total_count', (select count(*) from ranked where strpos(lower(team_name), lower(btrim(coalesce(p_search, '')))) > 0), 'visible', true, 'refreshed', false,
      'missing_scores', 0, 'fixture_count', 0, 'outstanding_fixtures', 0)
    into result;
    return result;
  end if;

  if not exists (select 1 from public.fantasy_gameweeks g where g.id = p_gameweek_id
    and public.gameweek_results_are_visible(g.first_match_starts_at)) then
    return jsonb_build_object('rows', '[]'::jsonb, 'total_count', 0, 'visible', false,
      'refreshed', false, 'missing_scores', 0, 'fixture_count', 0, 'outstanding_fixtures', 0);
  end if;

  with entries as materialized (select * from private.weekly_competition_rankings(p_gameweek_id)),
  ranked as (
    select e.*, e.competition_rank as rank from entries e where e.score_ready
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object(
    'rank', r.rank, 'team_name', r.team_name, 'points', r.points) order by r.rank, lower(r.team_name), r.team_id)
    from (select * from ranked where strpos(lower(team_name), lower(btrim(coalesce(p_search, '')))) > 0 order by rank, lower(team_name), team_id
      limit least(greatest(coalesce(p_limit, 25), 1), 50) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb),
    'total_count', (select count(*) from ranked where strpos(lower(team_name), lower(btrim(coalesce(p_search, '')))) > 0), 'visible', true,
    'refreshed', (select g.data_refreshed_at is not null from public.fantasy_gameweeks g where g.id = p_gameweek_id),
    'missing_scores', (select count(*) from entries where not score_ready),
    'fixture_count', (select count(*) from public.matches m where m.fantasy_gameweek_id = p_gameweek_id),
    'outstanding_fixtures', (select count(*) from public.matches m where m.fantasy_gameweek_id = p_gameweek_id and lower(m.status) <> 'scored'))
  into result;
  return result;
end;
$$;

-- The operator review uses exactly the same comparison as the public board.
-- No draw is executed and no candidate is automatically awarded or announced.
create or replace function public.get_weekly_competition_review(p_gameweek_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with entries as materialized (select * from private.weekly_competition_rankings(p_gameweek_id)),
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
    select * from leaders where competition_rank = 1
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
      'team_name', l.team_name, 'points', l.points, 'captain_raw_points', l.captain_raw_points,
      'season_points', l.season_points) order by l.team_id) from leaders l), '[]'::jsonb),
    'prize_candidates', coalesce((select jsonb_agg(jsonb_build_object('team_id', c.team_id,
      'team_name', c.team_name, 'points', c.points, 'captain_raw_points', c.captain_raw_points,
      'season_points', c.season_points) order by c.team_id) from finalists c), '[]'::jsonb),
    'draw_required', (select count(*) from finalists) > 1)
  from public.fantasy_gameweeks g cross join summary s cross join fixtures f where g.id = p_gameweek_id;
$$;

commit;

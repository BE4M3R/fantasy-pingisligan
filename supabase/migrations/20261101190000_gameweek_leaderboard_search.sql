begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Search AFTER ranking: matches keep their Gameweek rank, including ties.
-- The public projection continues to exclude account IDs and profile data.
drop function public.get_competition_standings(uuid, integer, integer);
create function public.get_competition_standings(p_gameweek_id uuid default null,
  p_offset integer default 0, p_limit integer default 25, p_search text default '')
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

  with entries as materialized (select * from private.weekly_competition_entries(p_gameweek_id)),
  ranked as (
    select e.*, rank() over (order by e.points desc) as rank from entries e where e.score_ready
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
revoke all on function public.get_competition_standings(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.get_competition_standings(uuid, integer, integer, text) to anon, authenticated, service_role;


-- Authenticated Leagues needs the same row shape as its global table to reuse
-- existing team previews and own-position highlighting. No emails or extra
-- private fields; stored scores and eligibility use the existing entry helper.
create function public.get_gameweek_leaderboard(p_gameweek_id uuid,
  p_search text default '', p_offset integer default 0, p_limit integer default 50,
  p_include_own boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if not exists (select 1 from public.fantasy_gameweeks g where g.id = p_gameweek_id
    and public.gameweek_results_are_visible(g.first_match_starts_at)) then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'visible', false);
  end if;
  with ranked as materialized (
    select rank() over (order by e.points desc) as rank,
      t.user_id, e.team_name, p.display_name, e.points as total_points
    from private.weekly_competition_entries(p_gameweek_id) e
    join public.fantasy_teams t on t.id = e.team_id
    left join public.profiles p on p.id = t.user_id
    where e.score_ready
  ), matched as materialized (
    select * from ranked where strpos(lower(team_name), lower(btrim(coalesce(p_search, '')))) > 0
  ), page as (
    select * from matched order by rank, lower(team_name), user_id
    limit least(greatest(coalesce(p_limit, 50), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
  ), displayed as (
    select * from page
    union all
    select * from matched m where p_include_own and coalesce(p_offset, 0) = 0
      and btrim(coalesce(p_search, '')) = '' and m.user_id = auth.uid()
      and not exists (select 1 from page p where p.user_id = m.user_id)
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(d)
      order by d.rank, lower(d.team_name), d.user_id) from displayed d), '[]'::jsonb),
    'total', (select count(*) from matched), 'visible', true) into result;
  return result;
end;
$$;
revoke all on function public.get_gameweek_leaderboard(uuid, text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.get_gameweek_leaderboard(uuid, text, integer, integer, boolean) to authenticated;

commit;

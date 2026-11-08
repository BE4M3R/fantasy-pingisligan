begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Ordinary signed-in Fantasy standings do not publish competition prizes.
-- Keep anonymous lifecycle reads behind the launch switch; authenticated
-- managers may use this existing metadata projection for the round selector.
create or replace function public.homepage_gameweek_states()
returns table (gameweek_id uuid, gameweek_number integer, lock_at timestamptz,
  state text, is_current boolean)
language sql stable security invoker set search_path = ''
as $$
  with transfer_state as materialized (
    select * from public.current_transfer_lock()
  ), target as (
    select case when t.is_locked then t.gameweek_id else (
      select g.id from public.fantasy_gameweeks g where g.lock_at > now()
      order by g.lock_at, g.id limit 1
    ) end as id from transfer_state t
  )
  select g.id, coalesce(g.round_order,
      row_number() over (order by g.lock_at, g.id)::integer), g.lock_at,
    case
      when g.data_refreshed_at is not null then 'previous'
      when g.lock_at <= now() and g.unlock_at < now() then 'refreshing'
      when g.lock_at <= now() then 'live'
      when g.id = t.id then 'open'
      else 'upcoming'
    end,
    coalesce(g.id = t.id, false)
  from public.fantasy_gameweeks g cross join target t
  where public.competitions_enabled() or auth.uid() is not null;
$$;

-- Reuse the existing scored, valid-snapshot projection without a prize gate.
-- Authentication, pagination, tied ranks and the scoring rules are unchanged.
create or replace function public.get_gameweek_leaderboard(p_gameweek_id uuid,
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

revoke all on function public.get_gameweek_leaderboard(uuid, text, integer, integer, boolean) from public, anon;
grant execute on function public.get_gameweek_leaderboard(uuid, text, integer, integer, boolean) to authenticated;

-- Competition routes, public standings, banners, rules and artwork retain
-- their existing publication controls. This migration never enables launch.
commit;

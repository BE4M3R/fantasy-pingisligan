begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- One explicit launch switch per database. Migrations never publish the feature.
create table public.competition_publication (
  id boolean primary key default true check (id),
  enabled boolean not null default false
);
insert into public.competition_publication (id, enabled) values (true, false);
alter table public.competition_publication enable row level security;
revoke all on public.competition_publication from anon, authenticated;
grant select on public.competition_publication to anon, authenticated;
grant all on public.competition_publication to service_role;
create policy "Competition launch state is readable" on public.competition_publication
  for select to anon, authenticated using (true);

create function public.competitions_enabled()
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select p.enabled from public.competition_publication p where p.id), false);
$$;
revoke all on function public.competitions_enabled() from public, anon, authenticated;
grant execute on function public.competitions_enabled() to anon, authenticated, service_role;

-- Restrictive policies AND the launch switch with the existing row-level gates.
-- Approval/readiness alone can never publish the feature. Operator preparation
-- remains possible, including draft content and ordinary scoring operations.
create policy "Competition feature must be launched" on public.homepage_banners
  as restrictive for select to anon, authenticated using (public.competitions_enabled());
create policy "Competition rules require feature launch" on public.competition_rules
  as restrictive for select to anon, authenticated using (public.competitions_enabled());

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
  where public.competitions_enabled();
$$;

create or replace function public.competition_gameweek_routes()
returns table (gameweek_id uuid, gameweek_number integer, public_path text)
language sql stable security invoker set search_path = '' as $$
  with numbered as (
    select g.id, coalesce(g.round_order, row_number() over (order by g.lock_at, g.id)::integer) as number
    from public.fantasy_gameweeks g
  ), counted as (
    select n.*, count(*) over (partition by n.number) as occurrences from numbered n
  )
  select c.id, c.number,
    '/competitions/gameweek/' || case when c.occurrences = 1 and c.number > 0
      then c.number::text else c.id::text end
  from counted c where public.competitions_enabled();
$$;

create or replace function public.get_homepage_competitions()
returns table (id text, kind text, gameweek_number integer, state text, is_current boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  cta_label text, cta_url text)
language sql stable security invoker set search_path = '' as $$
  with weeks as materialized (
    select s.*, row_number() over (partition by (s.state = 'upcoming') order by s.lock_at, s.gameweek_id) as upcoming_order
    from public.homepage_gameweek_states() s
  ), cards as (
    select 'gameweek:' || w.gameweek_id::text as id, 'gameweek'::text as kind,
      w.gameweek_number, w.state, w.is_current, coalesce(b.title, 'The Weekly Smash') as title,
      b.description, b.sponsor, b.image_path, b.image_alt, b.cta_label,
      case when w.state <> 'upcoming' then r.public_path end as cta_url, w.lock_at, w.gameweek_id
    from weeks w join public.competition_gameweek_routes() r on r.gameweek_id = w.gameweek_id
    left join public.homepage_banners b on b.gameweek_id = w.gameweek_id
    where w.state <> 'upcoming' or w.upcoming_order <= 2
    union all
    select 'season', 'season', null::integer,
      case when b.id is null then 'upcoming' else 'revealed' end, false,
      coalesce(b.title, 'Season Competition'), b.description, b.sponsor,
      b.image_path, b.image_alt, b.cta_label,
      case when b.id is not null then '/competitions/season' end, null::timestamptz, null::uuid
    from (select 1) seed left join public.homepage_banners b on b.kind = 'season'
  )
  select c.id, c.kind, c.gameweek_number, c.state, c.is_current,
    c.title, c.description, c.sponsor, c.image_path, c.image_alt, c.cta_label, c.cta_url
  from cards c where public.competitions_enabled() order by (c.kind = 'season'), c.lock_at, c.gameweek_id;
$$;


create or replace function public.get_public_competition(p_gameweek_id uuid default null)
returns table (gameweek_number integer, state text, content_available boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  prize_title text, prize_image_path text, prize_image_alt text, prize_description text,
  rules_markdown text, details_markdown text,
  prize_value_sek numeric, rules_version integer, rules_title text, public_path text, prize_product_url text)
language sql stable security invoker set search_path = '' as $$
  with competition as (
    select s.gameweek_number, s.state, b.id, b.title, b.description, b.sponsor,
      b.image_path, b.image_alt, b.cta_label, b.prize_image_path, b.prize_image_alt,
      b.prize_description, b.details_markdown, b.prize_value_sek, b.rules_version_id,
      r.public_path, b.prize_product_url
    from public.homepage_gameweek_states() s
    join public.competition_gameweek_routes() r on r.gameweek_id = s.gameweek_id
    left join public.homepage_banners b on b.gameweek_id = s.gameweek_id
    where p_gameweek_id is not null and s.gameweek_id = p_gameweek_id
    union all
    select null::integer, case when b.id is null then 'upcoming' else 'revealed' end,
      b.id, b.title, b.description, b.sponsor, b.image_path, b.image_alt, b.cta_label,
      b.prize_image_path, b.prize_image_alt, b.prize_description, b.details_markdown,
      b.prize_value_sek, b.rules_version_id, '/competitions/season', b.prize_product_url
    from (select 1) seed left join public.homepage_banners b on b.kind = 'season'
    where p_gameweek_id is null
  )
  select c.gameweek_number, c.state, c.id is not null,
    coalesce(c.title, case when p_gameweek_id is null then 'Season Competition' else 'The Weekly Smash' end),
    c.description, c.sponsor, c.image_path, c.image_alt, c.cta_label,
    c.prize_image_path, c.prize_image_alt, c.prize_description,
    r.body, c.details_markdown, c.prize_value_sek, r.version, r.title, c.public_path, c.prize_product_url
  from competition c left join public.competition_rules r on r.id = c.rules_version_id
  where public.competitions_enabled();
$$;

create or replace function public.get_competition_standings(p_gameweek_id uuid default null,
  p_offset integer default 0, p_limit integer default 25, p_search text default '')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.competitions_enabled() then
    raise exception 'Competition feature is unavailable.' using errcode = '42501';
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

create or replace function public.get_gameweek_leaderboard(p_gameweek_id uuid,
  p_search text default '', p_offset integer default 0, p_limit integer default 50,
  p_include_own boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.competitions_enabled() then
    raise exception 'Competition feature is unavailable.' using errcode = '42501';
  end if;
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

-- Artwork policies already require a readable banner reference. The new
-- restrictive banner policy therefore also blocks signing/downloading its art.
-- Announcement artwork keeps its separate existing publication restrictions.
commit;

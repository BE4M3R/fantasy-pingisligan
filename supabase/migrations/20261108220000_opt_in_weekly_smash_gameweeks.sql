begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Prize rounds are an explicit editorial choice, separate from Fantasy rounds.
-- Existing and newly imported Gameweeks start excluded; no prize is implied
-- until an operator opts in. Scoring, squads and league standings are untouched.
alter table public.fantasy_gameweeks
  add column weekly_smash_enabled boolean not null default false;
comment on column public.fantasy_gameweeks.weekly_smash_enabled is
  'Operator opt-in for Weekly Smash banners and prize pages; independent of Fantasy standings and the global competition publication switch.';

-- Reuse the existing banner/artwork/rule disclosure boundary. Approved text
-- and prize rows are preserved when a Gameweek is excluded.
create policy "Weekly prize content requires an opted-in Gameweek"
on public.homepage_banners as restrictive for select to anon, authenticated
using (kind = 'season' or exists (select 1 from public.fantasy_gameweeks g
  where g.id = homepage_banners.gameweek_id and g.weekly_smash_enabled));

-- Number all Fantasy rounds before filtering: hiding GW1 never renames GW2.
create or replace function public.competition_gameweek_routes()
returns table (gameweek_id uuid, gameweek_number integer, public_path text)
language sql stable security invoker set search_path = '' as $$
  with numbered as (
    select g.id, g.weekly_smash_enabled, coalesce(g.round_order, row_number() over (order by g.lock_at, g.id)::integer) as number
    from public.fantasy_gameweeks g
  ), counted as (
    select n.*, count(*) over (partition by n.number) as occurrences from numbered n
  )
  select c.id, c.number,
    '/competitions/gameweek/' || case when c.occurrences = 1 and c.number > 0
      then c.number::text else c.id::text end
  from counted c where public.competitions_enabled() and c.weekly_smash_enabled;
$$;

-- Filter before choosing the next two teasers, so excluded rounds use no slots.
create or replace function public.get_homepage_competitions()
returns table (id text, kind text, gameweek_number integer, state text, is_current boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  cta_label text, cta_url text)
language sql stable security invoker set search_path = '' as $$
  with weeks as materialized (
    select s.*, row_number() over (partition by (s.state = 'upcoming') order by s.lock_at, s.gameweek_id) as upcoming_order
    from public.homepage_gameweek_states() s
    join public.fantasy_gameweeks g on g.id = s.gameweek_id and g.weekly_smash_enabled
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


-- Detail pages already join the filtered route projection. Public standings
-- also enforce selection; signed-in Fantasy standings remain independent.
create or replace function public.get_competition_standings(p_gameweek_id uuid default null,
  p_offset integer default 0, p_limit integer default 25, p_search text default '')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.competitions_enabled() then
    raise exception 'Competition feature is unavailable.' using errcode = '42501';
  end if;
  if p_gameweek_id is not null and not exists (select 1 from public.fantasy_gameweeks g
    where g.id = p_gameweek_id and g.weekly_smash_enabled) then
    raise exception 'This Gameweek has no prize competition.' using errcode = '42501';
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

create or replace function public.get_public_competition_promotions()
returns table (kind text, gameweek_number integer, content_available boolean,
  title text, description text, sponsor text, prize_title text, prize_value_sek numeric,
  image_path text, image_alt text, public_path text)
language sql stable security invoker set search_path = '' as $$
  with chosen as (
    select s.gameweek_id from public.homepage_gameweek_states() s
    join public.competition_gameweek_routes() r on r.gameweek_id = s.gameweek_id
    where s.is_current or s.state = 'previous'
    order by s.is_current desc, s.lock_at desc, s.gameweek_id limit 1
  )
  select 'gameweek', c.gameweek_number, c.content_available, c.title, c.description,
    c.sponsor, c.prize_title, c.prize_value_sek, coalesce(c.prize_image_path, c.image_path),
    coalesce(c.prize_image_alt, c.image_alt), c.public_path
  from chosen w cross join lateral public.get_public_competition(w.gameweek_id) c
  union all
  select 'season', c.gameweek_number, c.content_available, c.title, c.description,
    c.sponsor, c.prize_title, c.prize_value_sek, coalesce(c.prize_image_path, c.image_path),
    coalesce(c.prize_image_alt, c.image_alt), c.public_path
  from public.get_public_competition(null) c;
$$;

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Use the existing Fantasy number, without inventing season identities. A
-- reused/ambiguous number keeps its UUID URL rather than choosing a wrong row.
create function public.competition_gameweek_routes()
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
  from counted c;
$$;
revoke all on function public.competition_gameweek_routes() from public, anon, authenticated;
grant execute on function public.competition_gameweek_routes() to anon, authenticated, service_role;

drop function public.get_public_competition(uuid);
create function public.get_public_competition(p_gameweek_id uuid default null)
returns table (gameweek_number integer, state text, content_available boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  prize_title text, prize_image_path text, prize_image_alt text, prize_description text,
  rules_markdown text, eligibility_markdown text, details_markdown text,
  prize_value_sek numeric, rules_version integer, rules_title text, public_path text)
language sql stable security invoker set search_path = '' as $$
  with competition as (
    select s.gameweek_number, s.state, b.id, b.title, b.description, b.sponsor,
      b.image_path, b.image_alt, b.cta_label, b.prize_image_path, b.prize_image_alt,
      b.prize_description, b.details_markdown, b.prize_value_sek, b.rules_version_id,
      r.public_path
    from public.homepage_gameweek_states() s
    join public.competition_gameweek_routes() r on r.gameweek_id = s.gameweek_id
    left join public.homepage_banners b on b.gameweek_id = s.gameweek_id
    where p_gameweek_id is not null and s.gameweek_id = p_gameweek_id
    union all
    select null::integer, case when b.id is null then 'upcoming' else 'revealed' end,
      b.id, b.title, b.description, b.sponsor, b.image_path, b.image_alt, b.cta_label,
      b.prize_image_path, b.prize_image_alt, b.prize_description, b.details_markdown,
      b.prize_value_sek, b.rules_version_id, '/competitions/season'
    from (select 1) seed left join public.homepage_banners b on b.kind = 'season'
    where p_gameweek_id is null
  )
  select c.gameweek_number, c.state, c.id is not null,
    coalesce(c.title, case when p_gameweek_id is null then 'Season Competition' else 'The Weekly Smash' end),
    c.description, c.sponsor, c.image_path, c.image_alt, c.cta_label,
    c.prize_image_path, c.prize_image_alt, c.prize_description,
    r.body, null::text, c.details_markdown, c.prize_value_sek, r.version, r.title, c.public_path
  from competition c left join public.competition_rules r on r.id = c.rules_version_id;
$$;
revoke all on function public.get_public_competition(uuid) from public, anon, authenticated;
grant execute on function public.get_public_competition(uuid) to anon, authenticated, service_role;

-- Preserve the carousel payload, ordering, selection, and embargo gates.
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
  from cards c order by (c.kind = 'season'), c.lock_at, c.gameweek_id;
$$;

-- Compact public discovery: current (or latest completed) Weekly Smash and
-- independently scheduled Season Competition. Never return bodies/draft fields.
create function public.get_public_competition_promotions()
returns table (kind text, gameweek_number integer, content_available boolean,
  title text, description text, sponsor text, prize_title text, prize_value_sek numeric,
  image_path text, image_alt text, public_path text)
language sql stable security invoker set search_path = '' as $$
  with chosen as (
    select s.gameweek_id from public.homepage_gameweek_states() s
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
revoke all on function public.get_public_competition_promotions() from public, anon, authenticated;
grant execute on function public.get_public_competition_promotions() to anon, authenticated, service_role;

commit;

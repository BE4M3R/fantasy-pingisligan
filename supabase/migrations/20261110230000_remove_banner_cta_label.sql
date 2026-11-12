begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Preserve the only available prize text on older rows before removing the
-- redundant short headline. Existing descriptions remain authoritative.
alter table public.homepage_banners disable trigger bind_competition_rules;
update public.homepage_banners
set description = cta_label
where nullif(btrim(description), '') is null and cta_label is not null;
alter table public.homepage_banners enable trigger bind_competition_rules;

-- Keep the established RPC signatures for callers. The homepage compatibility
-- field returns null; the detail prize_title field uses description.
create or replace function public.get_homepage_competitions()
returns table (id text, kind text, gameweek_number integer, state text, is_current boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  cta_label text, cta_url text)
language sql stable security invoker set search_path = '' as $$
  with weeks as materialized (
    select s.*, row_number() over (partition by (s.state = 'upcoming') order by s.lock_at, s.gameweek_id) as upcoming_order
    from public.homepage_gameweek_states() s
    join public.competition_publication p on p.gameweek_id = s.gameweek_id and p.enabled
  ), cards as (
    select 'gameweek:' || w.gameweek_id::text as id, 'gameweek'::text as kind,
      w.gameweek_number, w.state, w.is_current, coalesce(b.title, 'Gameweek ' || w.gameweek_number::text || ' competition') as title,
      b.description, b.sponsor, b.image_path, b.image_alt, null::text as cta_label,
      case when w.state <> 'upcoming' then r.public_path end as cta_url, w.lock_at, w.gameweek_id
    from weeks w join public.competition_gameweek_routes() r on r.gameweek_id = w.gameweek_id
    left join public.homepage_banners b on b.gameweek_id = w.gameweek_id
    where w.state <> 'upcoming' or w.upcoming_order <= 2
    union all
    select 'season', 'season', null::integer,
      case when b.id is null then 'upcoming' else 'revealed' end, false,
      coalesce(b.title, 'Season Competition'), b.description, b.sponsor,
      b.image_path, b.image_alt, null::text,
      case when b.id is not null then '/competitions/season' end, null::timestamptz, null::uuid
    from (select 1) seed left join public.homepage_banners b on b.kind = 'season'
    where public.season_competition_enabled()
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
      b.image_path, b.image_alt, b.description as prize_title, b.prize_image_path, b.prize_image_alt,
      b.prize_description, b.details_markdown, b.prize_value_sek, b.rules_version_id,
      r.public_path, b.prize_product_url
    from public.homepage_gameweek_states() s
    join public.competition_gameweek_routes() r on r.gameweek_id = s.gameweek_id
    left join public.homepage_banners b on b.gameweek_id = s.gameweek_id
    where p_gameweek_id is not null and s.gameweek_id = p_gameweek_id
    union all
    select null::integer, case when b.id is null then 'upcoming' else 'revealed' end,
      b.id, b.title, b.description, b.sponsor, b.image_path, b.image_alt, b.description as prize_title,
      b.prize_image_path, b.prize_image_alt, b.prize_description, b.details_markdown,
      b.prize_value_sek, b.rules_version_id, '/competitions/season', b.prize_product_url
    from (select 1) seed left join public.homepage_banners b on b.kind = 'season'
    where p_gameweek_id is null and public.season_competition_enabled()
  )
  select c.gameweek_number, c.state, c.id is not null,
    coalesce(c.title, case when p_gameweek_id is null then 'Season Competition' else 'Gameweek ' || c.gameweek_number::text || ' competition' end),
    c.description, c.sponsor, c.image_path, c.image_alt, c.prize_title,
    c.prize_image_path, c.prize_image_alt, c.prize_description,
    r.body, c.details_markdown, c.prize_value_sek, r.version, r.title, c.public_path, c.prize_product_url
  from competition c left join public.competition_rules r on r.id = c.rules_version_id
  where public.competitions_enabled();
$$;

alter table public.homepage_banners drop column cta_label;

commit;

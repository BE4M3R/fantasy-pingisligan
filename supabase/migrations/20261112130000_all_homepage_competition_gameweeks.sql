begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Return every opted-in round. Existing content RLS keeps future rounds generic
-- and destinations stay unavailable until the normal gameweek reveal.
create or replace function public.get_homepage_competitions()
returns table (id text, kind text, gameweek_number integer, state text, is_current boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  cta_label text, cta_url text)
language sql stable security invoker set search_path = '' as $$
  with weeks as (
    select s.*
    from public.homepage_gameweek_states() s
    join public.competition_publication p on p.gameweek_id = s.gameweek_id and p.enabled
  ), cards as (
    select 'gameweek:' || w.gameweek_id::text as id, 'gameweek'::text as kind,
      w.gameweek_number, w.state, w.is_current, coalesce(b.title, 'Gameweek ' || w.gameweek_number::text || ' competition') as title,
      b.prize_title as description, b.sponsor, b.image_path, b.image_alt, null::text as cta_label,
      case when w.state <> 'upcoming' then r.public_path end as cta_url, w.lock_at, w.gameweek_id
    from weeks w join public.competition_gameweek_routes() r on r.gameweek_id = w.gameweek_id
    left join public.homepage_banners b on b.gameweek_id = w.gameweek_id
    union all
    select 'season', 'season', null::integer,
      case when b.id is null then 'upcoming' else 'revealed' end, false,
      coalesce(b.title, 'Season Competition'), b.prize_title as description, b.sponsor,
      b.image_path, b.image_alt, null::text,
      case when b.id is not null then '/competitions/season' end, null::timestamptz, null::uuid
    from (select 1) seed left join public.homepage_banners b on b.kind = 'season'
    where public.season_competition_enabled()
  )
  select c.id, c.kind, c.gameweek_number, c.state, c.is_current,
    c.title, c.description, c.sponsor, c.image_path, c.image_alt, c.cta_label, c.cta_url
  from cards c where public.competitions_enabled() order by (c.kind = 'season'), c.lock_at, c.gameweek_id;
$$;

commit;

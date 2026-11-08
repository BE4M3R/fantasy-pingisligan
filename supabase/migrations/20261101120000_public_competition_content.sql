begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.homepage_banners
  add column prize_image_path text,
  add column prize_image_alt text,
  add column prize_description text check (length(prize_description) <= 20000),
  add column rules_markdown text check (length(rules_markdown) <= 20000),
  add column eligibility_markdown text check (length(eligibility_markdown) <= 20000),
  add column details_markdown text check (length(details_markdown) <= 20000),
  add constraint competition_prize_artwork_check check (prize_image_path is null or
    (length(btrim(prize_image_path)) > 0 and length(btrim(prize_image_alt)) > 0 and prize_image_alt is not null));

-- Only editorial/public fields are granted to anonymous readers. RLS still
-- guards every direct read, detail read, and referenced Storage object.
grant select (id, kind, gameweek_id, title, description, sponsor, image_path, image_alt,
  cta_label, cta_url, content_ready, published, publish_at, expires_at,
  prize_image_path, prize_image_alt, prize_description, rules_markdown,
  eligibility_markdown, details_markdown) on public.homepage_banners to anon;
grant execute on function public.homepage_gameweek_states() to anon;

drop policy "Revealed homepage competition content is readable" on public.homepage_banners;
create policy "Revealed homepage competition content is readable"
on public.homepage_banners for select to anon, authenticated using (
  (kind = 'gameweek' and content_ready and gameweek_id in (
    select s.gameweek_id from public.homepage_gameweek_states() s where s.state <> 'upcoming'
  )) or
  (kind = 'season' and published and publish_at <= now() and (expires_at is null or expires_at > now()))
);

drop policy "Revealed homepage competition artwork is readable" on storage.objects;
create policy "Revealed homepage competition artwork is readable"
on storage.objects for select to anon, authenticated using (
  bucket_id = 'announcement-artwork' and exists (
    select 1 from public.homepage_banners b
    where b.image_path = storage.objects.name or b.prize_image_path = storage.objects.name
  )
);

-- NULL means the existing single season competition. Unreadable content is
-- absent from the join; even a guessed UUID returns only generic public state.
create function public.get_public_competition(p_gameweek_id uuid default null)
returns table (gameweek_number integer, state text, content_available boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  prize_title text, prize_image_path text, prize_image_alt text, prize_description text,
  rules_markdown text, eligibility_markdown text, details_markdown text)
language sql stable security invoker set search_path = ''
as $$
  with competition as (
    select s.gameweek_number, s.state, b.id, b.title, b.description, b.sponsor,
      b.image_path, b.image_alt, b.cta_label, b.prize_image_path, b.prize_image_alt,
      b.prize_description, b.rules_markdown, b.eligibility_markdown, b.details_markdown
    from public.homepage_gameweek_states() s
    left join public.homepage_banners b on b.gameweek_id = s.gameweek_id
    where p_gameweek_id is not null and s.gameweek_id = p_gameweek_id
    union all
    select null::integer, case when b.id is null then 'upcoming' else 'revealed' end,
      b.id, b.title, b.description, b.sponsor, b.image_path, b.image_alt, b.cta_label,
      b.prize_image_path, b.prize_image_alt, b.prize_description, b.rules_markdown,
      b.eligibility_markdown, b.details_markdown
    from (select 1) seed left join public.homepage_banners b on b.kind = 'season'
    where p_gameweek_id is null
  )
  select c.gameweek_number, c.state, c.id is not null,
    coalesce(c.title, case when p_gameweek_id is null then 'Season Competition' else 'The Weekly Smash' end),
    c.description, c.sponsor, c.image_path, c.image_alt, c.cta_label,
    c.prize_image_path, c.prize_image_alt, c.prize_description, c.rules_markdown,
    c.eligibility_markdown, c.details_markdown
  from competition c;
$$;
revoke all on function public.get_public_competition(uuid) from public, anon, authenticated;
grant execute on function public.get_public_competition(uuid) to anon, authenticated, service_role;

-- Destinations are derived without overwriting editorial or legacy URLs.
create or replace function public.get_homepage_competitions()
returns table (id text, kind text, gameweek_number integer, state text, is_current boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  cta_label text, cta_url text)
language sql stable security invoker set search_path = ''
as $$
  with weeks as materialized (
    select s.*, row_number() over (partition by (s.state = 'upcoming') order by s.lock_at, s.gameweek_id) as upcoming_order
    from public.homepage_gameweek_states() s
  ), cards as (
    select 'gameweek:' || w.gameweek_id::text as id, 'gameweek'::text as kind,
      w.gameweek_number, w.state, w.is_current,
      coalesce(b.title, 'The Weekly Smash') as title,
      b.description, b.sponsor, b.image_path, b.image_alt, b.cta_label,
      case when w.state <> 'upcoming' then '/competitions/gameweek/' || w.gameweek_id::text end as cta_url,
      w.lock_at, w.gameweek_id
    from weeks w left join public.homepage_banners b on b.gameweek_id = w.gameweek_id
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
revoke all on function public.get_homepage_competitions() from public, anon;
grant execute on function public.get_homepage_competitions() to authenticated;

commit;

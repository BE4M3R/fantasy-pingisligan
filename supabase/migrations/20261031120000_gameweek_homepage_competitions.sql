begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Never choose between existing campaigns or remove content during conversion.
do $$ begin
  if exists (select 1 from public.homepage_banners where gameweek_id is not null
    group by gameweek_id having count(*) > 1)
    or (select count(*) from public.homepage_banners where kind = 'season') > 1 then
    raise exception 'Duplicate homepage competition content requires operator review before migration.';
  end if;
end; $$;

-- Keep every legacy publication value. Only already-public weekly reveal rows
-- become ready; scheduled, expired, draft and teaser rows need explicit review.
alter table public.homepage_banners add column content_ready boolean not null default false;
update public.homepage_banners set content_ready = true
where kind in ('current', 'previous') and published and publish_at <= now()
  and (expires_at is null or expires_at > now());

-- Replace kind constraints and the paired CTA requirement. Keep the existing
-- length, artwork and publication-date checks, including stored legacy values.
do $$ declare constraint_row record; begin
  for constraint_row in
    select conname from pg_constraint
    where conrelid = 'public.homepage_banners'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ~ '\mkind\M'
        or (pg_get_constraintdef(oid) ~ '\mcta_label\M' and pg_get_constraintdef(oid) ~ '\mcta_url\M'))
  loop
    execute format('alter table public.homepage_banners drop constraint %I', constraint_row.conname);
  end loop;
end; $$;

update public.homepage_banners set kind = 'gameweek' where kind <> 'season';
alter table public.homepage_banners alter column kind set default 'gameweek';
alter table public.homepage_banners
  add constraint homepage_banners_kind_check check (kind in ('gameweek', 'season')),
  add constraint homepage_banners_gameweek_check check (
    (kind = 'season' and gameweek_id is null) or (kind = 'gameweek' and gameweek_id is not null)),
  add constraint homepage_banners_destination_check check (
    cta_url is null or cta_url ~ '^(https://[^[:space:]]+|/[^/\\[:space:]][^[:space:]]*|/)$');

create unique index homepage_banners_gameweek_unique on public.homepage_banners (gameweek_id)
  where gameweek_id is not null;
create unique index homepage_banners_season_unique on public.homepage_banners (kind) where kind = 'season';

-- This helper reads only public Fantasy state, never banner content: banner
-- RLS calls it too. No stored competition state or independent schedule.
create function public.homepage_gameweek_states()
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
  from public.fantasy_gameweeks g cross join target t;
$$;
revoke all on function public.homepage_gameweek_states() from public, anon;
grant execute on function public.homepage_gameweek_states() to authenticated, service_role;

drop policy "Due homepage banners are readable" on public.homepage_banners;
create policy "Revealed homepage competition content is readable"
on public.homepage_banners for select to authenticated using (
  (kind = 'gameweek' and content_ready and gameweek_id in (
    select s.gameweek_id from public.homepage_gameweek_states() s where s.state <> 'upcoming'
  )) or
  (kind = 'season' and published and publish_at <= now() and (expires_at is null or expires_at > now()))
);

-- The referenced banner SELECT applies RLS, making artwork use the same gate.
-- Announcement artwork keeps its separate policy. Embargoed paths must be unique.
drop policy "Published homepage banner artwork is readable" on storage.objects;
create policy "Revealed homepage competition artwork is readable"
on storage.objects for select to authenticated using (
  bucket_id = 'announcement-artwork' and exists (
    select 1 from public.homepage_banners b where b.image_path = storage.objects.name
  )
);

-- Unreadable metadata is absent from the LEFT JOIN, including custom titles,
-- descriptions, destinations and paths. Always append one season card.
create function public.get_homepage_competitions()
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
      b.description, b.sponsor, b.image_path, b.image_alt, b.cta_label, b.cta_url,
      w.lock_at, w.gameweek_id
    from weeks w left join public.homepage_banners b on b.gameweek_id = w.gameweek_id
    where w.state <> 'upcoming' or w.upcoming_order <= 2
    union all
    select 'season', 'season', null::integer,
      case when b.id is null then 'upcoming' else 'revealed' end, false,
      coalesce(b.title, 'Season Competition'), b.description, b.sponsor,
      b.image_path, b.image_alt, b.cta_label, b.cta_url, null::timestamptz, null::uuid
    from (select 1) seed left join public.homepage_banners b on b.kind = 'season'
  )
  select c.id, c.kind, c.gameweek_number, c.state, c.is_current,
    c.title, c.description, c.sponsor, c.image_path, c.image_alt, c.cta_label, c.cta_url
  from cards c order by (c.kind = 'season'), c.lock_at, c.gameweek_id;
$$;
revoke all on function public.get_homepage_competitions() from public, anon;
grant execute on function public.get_homepage_competitions() to authenticated;

commit;

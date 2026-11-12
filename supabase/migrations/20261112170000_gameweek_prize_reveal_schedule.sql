begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.homepage_banners
  add column prize_reveal_at timestamptz,
  add constraint homepage_banners_prize_reveal_gameweek_only check (prize_reveal_at is null or kind = 'gameweek');
comment on column public.homepage_banners.prize_reveal_at is
  'Public prize reveal schedule. Defaults to the preceding Fantasy Gameweek unlock_at, including non-prize rounds. Edit with an explicit timezone to move the actual reveal; NULL restores the Fantasy lifecycle gate. content_ready is still required.';
grant select (prize_reveal_at) on public.homepage_banners to anon, authenticated;

-- Preceding Fantasy round, not preceding prize round. GW1 has no preceding
-- unlock and uses the existing pre-season lifecycle when its date is NULL.
create function private.gameweek_prize_reveal_defaults()
returns table (gameweek_id uuid, prize_reveal_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.id, lag(g.unlock_at) over (order by g.lock_at, g.id)
  from public.fantasy_gameweeks g;
$$;
revoke all on function private.gameweek_prize_reveal_defaults() from public, anon, authenticated, service_role;

-- Preserve existing content, readiness, IDs, rule bindings and publication.
alter table public.homepage_banners disable trigger bind_competition_rules;
update public.homepage_banners b set prize_reveal_at = d.prize_reveal_at
from private.gameweek_prize_reveal_defaults() d where b.gameweek_id = d.gameweek_id;
insert into public.homepage_banners (kind, gameweek_id, prize_reveal_at)
select 'gameweek', d.gameweek_id, d.prize_reveal_at
from private.gameweek_prize_reveal_defaults() d
on conflict (gameweek_id) where gameweek_id is not null do nothing;
alter table public.homepage_banners enable trigger bind_competition_rules;

-- Statement-level import hook sees every round in a batch before calculating
-- defaults. Schedule updates never replace saved dates or editorial content.
create function private.create_gameweek_homepage_banners()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.homepage_banners (kind, gameweek_id, prize_reveal_at)
  select 'gameweek', d.gameweek_id, d.prize_reveal_at
  from private.gameweek_prize_reveal_defaults() d
  join inserted_gameweeks g on g.id = d.gameweek_id
  on conflict (gameweek_id) where gameweek_id is not null do nothing;
  return null;
end;
$$;
revoke all on function private.create_gameweek_homepage_banners() from public, anon, authenticated, service_role;
create trigger create_gameweek_homepage_banners after insert on public.fantasy_gameweeks
referencing new table as inserted_gameweeks
for each statement execute function private.create_gameweek_homepage_banners();

-- Only public scheduling metadata bypasses prize RLS. NULL retains the
-- existing refresh-dependent lifecycle, also covering a deleted optional row.
create function public.get_public_gameweek_banner_schedule()
returns table (gameweek_id uuid, prize_reveal_at timestamptz, prize_revealed boolean)
language sql stable security definer set search_path = '' as $$
  select s.gameweek_id, coalesce(b.prize_reveal_at, d.prize_reveal_at),
    case when b.prize_reveal_at is not null then b.prize_reveal_at <= now()
      else s.state <> 'upcoming' end
  from public.homepage_gameweek_states() s
  join public.competition_publication p on p.gameweek_id = s.gameweek_id and p.enabled
  join private.gameweek_prize_reveal_defaults() d on d.gameweek_id = s.gameweek_id
  left join public.homepage_banners b on b.gameweek_id = s.gameweek_id
  where public.competitions_enabled();
$$;
revoke all on function public.get_public_gameweek_banner_schedule() from public;
grant execute on function public.get_public_gameweek_banner_schedule() to anon, authenticated, service_role;

drop policy "Revealed homepage competition content is readable" on public.homepage_banners;
create policy "Revealed homepage competition content is readable"
on public.homepage_banners for select to anon, authenticated using (
  (kind = 'gameweek' and content_ready and (
    (prize_reveal_at is not null and prize_reveal_at <= now()) or
    (prize_reveal_at is null and gameweek_id in (
      select s.gameweek_id from public.homepage_gameweek_states() s where s.state <> 'upcoming'
    ))
  )) or
  (kind = 'season' and published and publish_at <= now() and (expires_at is null or expires_at > now()))
);

-- Keep Fantasy state independent of the prize schedule. These narrow public
-- states are reused by Home and the detail page; artwork follows banner RLS.
create function public.homepage_prize_gameweek_states()
returns table (gameweek_id uuid, gameweek_number integer, lock_at timestamptz,
  state text, is_current boolean, prize_reveal_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select s.gameweek_id, s.gameweek_number, s.lock_at,
    case when not p.prize_revealed then 'upcoming'
      when s.state = 'upcoming' then 'open' else s.state end,
    s.is_current, p.prize_reveal_at
  from public.homepage_gameweek_states() s
  join public.get_public_gameweek_banner_schedule() p on p.gameweek_id = s.gameweek_id;
$$;
revoke all on function public.homepage_prize_gameweek_states() from public;
grant execute on function public.homepage_prize_gameweek_states() to anon, authenticated, service_role;

drop function public.get_homepage_competitions();
create function public.get_homepage_competitions()
returns table (id text, kind text, gameweek_number integer, state text, is_current boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  cta_label text, cta_url text, prize_reveal_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with weeks as (
    select s.*, t.teaser
    from public.homepage_prize_gameweek_states() s
    join public.competition_publication p on p.gameweek_id = s.gameweek_id and p.enabled
    left join public.get_public_gameweek_teasers() t on t.gameweek_id = s.gameweek_id
  ), cards as (
    select 'gameweek:' || w.gameweek_id::text as id, 'gameweek'::text as kind,
      w.gameweek_number, w.state, w.is_current, coalesce(b.title, 'Gameweek ' || w.gameweek_number::text || ' competition') as title,
      b.prize_title as description, b.sponsor, b.image_path, b.image_alt, w.teaser as cta_label,
      case when w.state <> 'upcoming' then r.public_path end as cta_url, w.lock_at, w.gameweek_id, w.prize_reveal_at
    from weeks w join public.competition_gameweek_routes() r on r.gameweek_id = w.gameweek_id
    left join public.homepage_banners b on b.gameweek_id = w.gameweek_id
    union all
    select 'season', 'season', null::integer,
      case when b.id is null then 'upcoming' else 'revealed' end, false,
      coalesce(b.title, 'Season Competition'), b.prize_title as description, b.sponsor,
      b.image_path, b.image_alt, null::text,
      case when b.id is not null then '/competitions/season' end, null::timestamptz, null::uuid, null::timestamptz
    from (select 1) seed left join public.homepage_banners b on b.kind = 'season'
    where public.season_competition_enabled()
  )
  select c.id, c.kind, c.gameweek_number, c.state, c.is_current,
    c.title, c.description, c.sponsor, c.image_path, c.image_alt, c.cta_label, c.cta_url, c.prize_reveal_at
  from cards c where public.competitions_enabled() order by (c.kind = 'season'), c.lock_at, c.gameweek_id;
$$;

revoke all on function public.get_homepage_competitions() from public, anon;
grant execute on function public.get_homepage_competitions() to authenticated;

create or replace function public.get_public_competition(p_gameweek_id uuid default null)
returns table (gameweek_number integer, state text, content_available boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  prize_title text, prize_image_path text, prize_image_alt text, prize_description text,
  rules_markdown text, details_markdown text,
  prize_value_sek numeric, rules_version integer, rules_title text, public_path text, prize_product_url text)
language sql stable security invoker set search_path = '' as $$
  with competition as (
    select s.gameweek_number, s.state, b.id, b.title, null::text as description, b.sponsor,
      b.image_path, b.image_alt, b.prize_title, b.prize_image_path, b.prize_image_alt,
      b.prize_description, b.details_markdown, b.prize_value_sek, b.rules_version_id,
      r.public_path, b.prize_product_url
    from public.homepage_prize_gameweek_states() s
    join public.competition_gameweek_routes() r on r.gameweek_id = s.gameweek_id
    left join public.homepage_banners b on b.gameweek_id = s.gameweek_id
    where p_gameweek_id is not null and s.gameweek_id = p_gameweek_id
    union all
    select null::integer, case when b.id is null then 'upcoming' else 'revealed' end,
      b.id, b.title, null::text as description, b.sponsor, b.image_path, b.image_alt, b.prize_title,
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

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.homepage_banners
  add column teaser text,
  add constraint homepage_banners_teaser_length_check check (teaser is null or length(btrim(teaser)) between 1 and 240),
  add constraint homepage_banners_teaser_gameweek_only check (teaser is null or kind = 'gameweek');
comment on column public.homepage_banners.teaser is
  'Optional public Home teaser before Gameweek prize reveal. Editable in Table Editor, independent of content_ready; never put embargoed prize details here.';
grant select (teaser) on public.homepage_banners to anon, authenticated;

-- Preserve exact copy, including cleared values, without changing ready flags,
-- prize fields, publication choices, or existing rules-version bindings.
alter table public.homepage_banners disable trigger bind_competition_rules;
insert into public.homepage_banners (kind, gameweek_id, teaser)
select 'gameweek', p.gameweek_id, p.teaser
from public.competition_publication p where p.gameweek_id is not null
on conflict (gameweek_id) where gameweek_id is not null
do update set teaser = excluded.teaser;
alter table public.homepage_banners enable trigger bind_competition_rules;

do $$ begin
  if exists (
    select 1 from public.competition_publication p
    left join public.homepage_banners b on b.gameweek_id = p.gameweek_id
    where p.gameweek_id is not null and (b.id is null or b.teaser is distinct from p.teaser)
  ) then
    raise exception 'Gameweek teaser copy was not preserved; migration rolled back.';
  end if;
end; $$;

-- New banner rows get editable defaults. Updates never refill a cleared value.
create function private.set_homepage_banner_teaser_default()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'gameweek' and new.teaser is null then
    select private.default_gameweek_competition_teaser(s.gameweek_number)
    into new.teaser
    from public.homepage_gameweek_states() s where s.gameweek_id = new.gameweek_id;
  end if;
  return new;
end;
$$;
revoke all on function private.set_homepage_banner_teaser_default() from public, anon, authenticated, service_role;
create trigger set_homepage_banner_teaser_default before insert on public.homepage_banners
for each row execute function private.set_homepage_banner_teaser_default();

-- Publication rows contain controls; banner text is managed independently.
create or replace function private.sync_gameweek_competition_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.competition_publication (id, gameweek_id, name, enabled)
  select 'gameweek:' || g.id::text, g.id,
    'Gameweek ' || coalesce(g.round_order, row_number() over (order by g.lock_at, g.id)::integer)::text || ' competition', false
  from public.fantasy_gameweeks g
  on conflict (id) do update set name = excluded.name
    where competition_publication.name is distinct from excluded.name;
  return null;
end;
$$;

-- Only the public teaser bypasses banner-row RLS. No prize fields, artwork,
-- winner team references, or unapproved rules are exposed by this projection.
create function public.get_public_gameweek_teasers()
returns table (gameweek_id uuid, teaser text)
language sql stable security definer set search_path = '' as $$
  select s.gameweek_id,
    case when b.id is null then private.default_gameweek_competition_teaser(s.gameweek_number)
      else b.teaser end
  from public.homepage_gameweek_states() s
  join public.competition_publication p on p.gameweek_id = s.gameweek_id and p.enabled
  left join public.homepage_banners b on b.gameweek_id = s.gameweek_id
  where public.competitions_enabled();
$$;
revoke all on function public.get_public_gameweek_teasers() from public;
grant execute on function public.get_public_gameweek_teasers() to anon, authenticated, service_role;

-- Keep the existing Home RPC signature and invoker/RLS prize reads. Public
-- teaser copy still uses its legacy cta_label slot, aliased by the app.
create or replace function public.get_homepage_competitions()
returns table (id text, kind text, gameweek_number integer, state text, is_current boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  cta_label text, cta_url text)
language sql stable security invoker set search_path = '' as $$
  with weeks as (
    select s.*, t.teaser
    from public.homepage_gameweek_states() s
    join public.competition_publication p on p.gameweek_id = s.gameweek_id and p.enabled
    left join public.get_public_gameweek_teasers() t on t.gameweek_id = s.gameweek_id
  ), cards as (
    select 'gameweek:' || w.gameweek_id::text as id, 'gameweek'::text as kind,
      w.gameweek_number, w.state, w.is_current, coalesce(b.title, 'Gameweek ' || w.gameweek_number::text || ' competition') as title,
      b.prize_title as description, b.sponsor, b.image_path, b.image_alt, w.teaser as cta_label,
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

alter table public.competition_publication drop column teaser;

commit;

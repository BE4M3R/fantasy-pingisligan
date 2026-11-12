begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Teasers are public editorial copy even before a prize can be revealed. Keep
-- them on the readable publication row instead of the embargoed banner row.
alter table public.competition_publication
  add column teaser text,
  add constraint competition_teaser_length_check check (teaser is null or length(btrim(teaser)) between 1 and 240),
  add constraint competition_teaser_gameweek_only check (teaser is null or gameweek_id is not null);
comment on column public.competition_publication.teaser is
  'Optional public Home teaser for this Gameweek before prize reveal. Editable in Table Editor; never put embargoed prize details here.';
grant select (teaser) on public.competition_publication to anon, authenticated;

-- Initial copy for existing rounds and defaults for newly imported rounds.
-- Once stored, an operator's edits (including clearing the value) are retained.
create function private.default_gameweek_competition_teaser(p_number integer)
returns text language sql immutable set search_path = '' as $$
  select case p_number
    when 4 then 'Something big is coming... 👀'
    when 5 then 'A new prize is on the horizon! 🏆'
    when 6 then 'Ready for the next challenge?'
    when 7 then 'Something special is up for grabs...'
    when 8 then 'New Gameweek. New prize. 🔥'
    when 9 then 'The next reward is waiting...'
    when 10 then 'Think you''ve got what it takes?'
    when 11 then 'Another Gameweek. Another chance to win!'
    when 12 then 'A little surprise is coming your way... 👀'
    when 13 then 'The next prize could be yours!'
  end;
$$;
revoke all on function private.default_gameweek_competition_teaser(integer) from public, anon, authenticated, service_role;

update public.competition_publication p
set teaser = private.default_gameweek_competition_teaser(s.gameweek_number)
from public.homepage_gameweek_states() s
where p.gameweek_id = s.gameweek_id and p.teaser is null;

create or replace function private.sync_gameweek_competition_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.competition_publication (id, gameweek_id, name, enabled, teaser)
  select 'gameweek:' || g.id::text, g.id,
    'Gameweek ' || g.number::text || ' competition', false,
    private.default_gameweek_competition_teaser(g.number)
  from (
    select id, coalesce(round_order, row_number() over (order by lock_at, id)::integer) as number
    from public.fantasy_gameweeks
  ) g
  on conflict (id) do update set name = excluded.name
    where competition_publication.name is distinct from excluded.name;
  return null;
end;
$$;

-- Preserve the established RPC shape. The unused legacy cta_label output now
-- carries the public teaser, aliased to teaser by the Home reader.
create or replace function public.get_homepage_competitions()
returns table (id text, kind text, gameweek_number integer, state text, is_current boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  cta_label text, cta_url text)
language sql stable security invoker set search_path = '' as $$
  with weeks as (
    select s.*, p.teaser
    from public.homepage_gameweek_states() s
    join public.competition_publication p on p.gameweek_id = s.gameweek_id and p.enabled
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

commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Keep one readable row per switch, rather than adding a column per round.
-- The two singleton rows preserve the previous global and season choices.
alter table public.competition_publication
  alter column id drop default,
  drop constraint competition_publication_id_check;
alter table public.competition_publication
  alter column id type text using 'global'::text,
  add column gameweek_id uuid unique references public.fantasy_gameweeks(id) on delete cascade,
  add column name text;
update public.competition_publication set name = 'All competitions' where id = 'global';
insert into public.competition_publication (id, name, enabled)
select 'season', 'Season competition', season_enabled from public.competition_publication where id = 'global';
insert into public.competition_publication (id, gameweek_id, name, enabled)
select 'gameweek:' || g.id::text, g.id,
  'Gameweek ' || coalesce(g.round_order, row_number() over (order by g.lock_at, g.id)::integer)::text || ' competition',
  g.weekly_smash_enabled
from public.fantasy_gameweeks g;
alter table public.competition_publication
  drop column season_enabled,
  alter column name set not null,
  add constraint competition_publication_target_check check (
    (id in ('global', 'season') and gameweek_id is null)
    or (gameweek_id is not null and id = 'gameweek:' || gameweek_id::text)
  );
comment on table public.competition_publication is
  'Operator-controlled switches: global, season, and one Gameweek competition row per Fantasy round. Schedule and scoring remain authoritative for timing.';

create or replace function public.competitions_enabled()
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select p.enabled from public.competition_publication p where p.id = 'global'), false);
$$;
create or replace function public.season_competition_enabled()
returns boolean language sql stable security invoker set search_path = '' as $$
  select public.competitions_enabled() and coalesce((select p.enabled
    from public.competition_publication p where p.id = 'season'), false);
$$;

-- Future imports create disabled rows automatically. Renumbering updates only
-- labels; an ordinary schedule upsert never changes editorial enable choices.
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
revoke all on function private.sync_gameweek_competition_publication() from public, anon, authenticated, service_role;
create trigger sync_gameweek_competition_publication
  after insert or delete or update of round_order, lock_at on public.fantasy_gameweeks
  for each statement execute function private.sync_gameweek_competition_publication();

drop policy "Weekly prize content requires an opted-in Gameweek" on public.homepage_banners;
create policy "Gameweek prize content requires enabled publication"
on public.homepage_banners as restrictive for select to anon, authenticated
using (kind = 'season' or exists (select 1 from public.competition_publication p
  where p.gameweek_id = homepage_banners.gameweek_id and p.enabled));

-- All existing switches were copied before removing the old editorial column.
alter table public.fantasy_gameweeks drop column weekly_smash_enabled;

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
  from counted c join public.competition_publication p on p.gameweek_id = c.id and p.enabled
  where public.competitions_enabled();
$$;

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
    where p_gameweek_id is null and public.season_competition_enabled()
  )
  select c.gameweek_number, c.state, c.id is not null,
    coalesce(c.title, case when p_gameweek_id is null then 'Season Competition' else 'Gameweek ' || c.gameweek_number::text || ' competition' end),
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
  if p_gameweek_id is not null and not exists (select 1 from public.competition_publication p
    where p.gameweek_id = p_gameweek_id and p.enabled) then
    raise exception 'This Gameweek has no prize competition.' using errcode = '42501';
  end if;
  if p_gameweek_id is null and not public.season_competition_enabled() then
    raise exception 'Season competition is unavailable.' using errcode = '42501';
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

-- Rebrand editable prize copy without changing publication, artwork paths or
-- existing rules bindings. The assignment trigger must not bind previously
-- unbound prizes as a side effect of this copy-only update.
alter table public.homepage_banners disable trigger bind_competition_rules;
update public.homepage_banners set
  title = case when btrim(title) ~* '^(The )?Weekly Smash$' then null
    else regexp_replace(title, '(The )?Weekly Smash', 'Gameweek competition', 'gi') end,
  description = regexp_replace(description, '(The )?Weekly Smash', 'Gameweek competition', 'gi'),
  cta_label = regexp_replace(cta_label, '(The )?Weekly Smash', 'Gameweek competition', 'gi'),
  details_markdown = regexp_replace(details_markdown, '(The )?Weekly Smash', 'Gameweek competition', 'gi'),
  prize_description = regexp_replace(prize_description, '(The )?Weekly Smash', 'Gameweek competition', 'gi'),
  image_alt = regexp_replace(image_alt, '(The )?Weekly Smash', 'Gameweek competition', 'gi'),
  prize_image_alt = regexp_replace(prize_image_alt, '(The )?Weekly Smash', 'Gameweek competition', 'gi')
where kind = 'gameweek' and concat_ws(' ', title, description, cta_label,
  details_markdown, prize_description, image_alt, prize_image_alt) ~* 'Weekly Smash';
alter table public.homepage_banners enable trigger bind_competition_rules;

-- Approved documents and bound versions remain immutable. Rename editable
-- drafts; if none exists, prepare one unapproved replacement of the latest
-- approved gameweek document for deliberate operator review. Never auto-approve.
update public.competition_rules set
  title = regexp_replace(title, '(The )?Weekly Smash', 'Gameweek competition', 'gi'),
  body = regexp_replace(body, '(The )?Weekly Smash', 'Gameweek competition', 'gi')
where kind = 'gameweek' and approved_at is null
  and concat_ws(' ', title, body) ~* 'Weekly Smash';
insert into public.competition_rules (kind, version, title, body)
select r.kind, (select max(v.version) + 1 from public.competition_rules v where v.kind = r.kind),
  'Gameweek competition rules (renamed draft)',
  regexp_replace(r.body, '(The )?Weekly Smash', 'Gameweek competition', 'gi')
from (select * from public.competition_rules where kind = 'gameweek' and approved_at is not null
  order by version desc limit 1) r
where concat_ws(' ', r.title, r.body) ~* 'Weekly Smash'
  and not exists (select 1 from public.competition_rules d where d.kind = r.kind and d.approved_at is null);

commit;

-- Disposable-only legacy publication state. The surrounding runner rolls back.
begin;
alter table public.homepage_banners add column cta_label text;
grant select (cta_label) on public.homepage_banners to anon;
drop trigger sync_gameweek_competition_publication on public.fantasy_gameweeks;
drop policy "Gameweek prize content requires enabled publication" on public.homepage_banners;
drop table public.competition_publication;
create table public.competition_publication (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  season_enabled boolean not null default false
);
alter table public.competition_publication enable row level security;
grant select on public.competition_publication to anon, authenticated;
grant all on public.competition_publication to service_role;
create policy "Competition launch state is readable" on public.competition_publication
  for select to anon, authenticated using (true);
insert into public.competition_publication (enabled, season_enabled) values (__GLOBAL__, __SEASON__);
alter table public.fantasy_gameweeks add column weekly_smash_enabled boolean not null default false;
create policy "Weekly prize content requires an opted-in Gameweek"
on public.homepage_banners as restrictive for select to anon, authenticated
using (kind = 'season' or exists (select 1 from public.fantasy_gameweeks g
  where g.id = homepage_banners.gameweek_id and g.weekly_smash_enabled));

insert into public.fantasy_gameweeks (id, stupa_stage_id, stupa_round_id, name,
  round_order, lock_at, unlock_at, first_match_starts_at, last_match_ends_at, weekly_smash_enabled)
values
  ('00000000-0000-0000-0000-000000006001', -1999999400, -1999999401, 'Competition migration GW1',
   1, now() + interval '1 hour', now() + interval '2 days', now() + interval '3 hours', now() + interval '1 day', true),
  ('00000000-0000-0000-0000-000000006002', -1999999400, -1999999402, 'Competition migration GW2',
   2, now() + interval '3 days', now() + interval '5 days', now() + interval '4 days', now() + interval '4 days', false);
insert into public.competition_rules (id, kind, version, title, body, approved_at) values
  ('00000000-0000-0000-0000-000000006101', 'gameweek', 6001, 'Weekly Smash approved rules', 'The Weekly Smash original approved terms', now());
__DRAFT__
insert into public.homepage_banners (id, gameweek_id, title, content_ready, sponsor) values
  ('00000000-0000-0000-0000-000000006201', '00000000-0000-0000-0000-000000006001', 'The Weekly Smash', true, 'Existing partner');
-- Simulate valid legacy unbound content: a copy update must not bind new terms.
alter table public.homepage_banners disable trigger bind_competition_rules;
insert into public.homepage_banners (id, gameweek_id, title, content_ready, description) values
  ('00000000-0000-0000-0000-000000006202', '00000000-0000-0000-0000-000000006002', 'Custom prize', true, 'Weekly Smash prize details');
alter table public.homepage_banners enable trigger bind_competition_rules;
create temp table before_weeks on commit drop as select to_jsonb(g) - 'weekly_smash_enabled' as row from public.fantasy_gameweeks g;

__MIGRATION__

do $test$ begin
  if (select enabled from public.competition_publication where id = 'global') is distinct from __GLOBAL__
    or (select enabled from public.competition_publication where id = 'season') is distinct from __SEASON__ then
    raise exception 'Singleton publication choices changed'; end if;
  if not (select enabled from public.competition_publication where gameweek_id = '00000000-0000-0000-0000-000000006001')
    or (select enabled from public.competition_publication where gameweek_id = '00000000-0000-0000-0000-000000006002') then
    raise exception 'Per-gameweek choices changed'; end if;
  if (select count(*) from public.competition_publication) <> 4 then raise exception 'Missing or duplicate switch rows'; end if;
  if (select name from public.competition_publication where gameweek_id = '00000000-0000-0000-0000-000000006001')
    is distinct from 'Gameweek 1 competition' then raise exception 'Missing readable gameweek name'; end if;
  if exists (select 1 from before_weeks old where not exists (
    select 1 from public.fantasy_gameweeks g where to_jsonb(g) = old.row)) then
    raise exception 'Fantasy schedule or lifecycle state changed'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
    and column_name in ('weekly_smash_enabled', 'season_enabled')) then raise exception 'Obsolete switch columns remain'; end if;
  if (select rules_version_id from public.homepage_banners where id = '00000000-0000-0000-0000-000000006201')
    is distinct from '00000000-0000-0000-0000-000000006101'::uuid then raise exception 'Historical rule binding changed'; end if;
  if (select rules_version_id from public.homepage_banners where id = '00000000-0000-0000-0000-000000006202') is not null then
    raise exception 'Copy rename implicitly bound an unbound prize'; end if;
  if (select body from public.competition_rules where id = '00000000-0000-0000-0000-000000006101')
    is distinct from 'The Weekly Smash original approved terms' then raise exception 'Approved history changed'; end if;
  if not exists (select 1 from public.competition_rules where kind = 'gameweek' and approved_at is null)
    or exists (select 1 from public.competition_rules where approved_at is null and concat_ws(' ', title, body) ~* 'Weekly Smash') then
    raise exception 'Renamed unapproved terms are missing'; end if;
  if (select title from public.homepage_banners where id = '00000000-0000-0000-0000-000000006201') is not null
    or (select description from public.homepage_banners where id = '00000000-0000-0000-0000-000000006202')
      is distinct from 'Gameweek competition prize details' then raise exception 'Editable copy was not renamed'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.homepage_banners'::regclass
    and tgname = 'bind_competition_rules' and tgenabled = 'O') then raise exception 'Rule assignment trigger was not restored'; end if;
end; $test$;

update public.competition_publication set enabled = true where id = 'global';
set local role anon;
do $test$ begin
  if (select title from public.get_public_competition('00000000-0000-0000-0000-000000006001'))
    is distinct from 'Gameweek 1 competition' then raise exception 'Numbered title was not generated'; end if;
  if exists (select 1 from public.get_public_competition('00000000-0000-0000-0000-000000006002')) then
    raise exception 'Excluded gameweek content leaked'; end if;
end; $test$;
reset role;
rollback;

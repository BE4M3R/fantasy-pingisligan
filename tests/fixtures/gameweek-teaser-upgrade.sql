-- Reconstruct the immediately preceding teaser schema, then run the real move.
-- The upgrade runner supplies the migration and rolls the complete case back.
begin;
drop trigger set_homepage_banner_teaser_default on public.homepage_banners;
drop function private.set_homepage_banner_teaser_default();
drop function public.get_public_gameweek_teasers();
alter table public.homepage_banners drop column teaser;
alter table public.competition_publication add column teaser text;
grant select (teaser) on public.competition_publication to anon, authenticated;
insert into public.fantasy_gameweeks (id, stupa_stage_id, stupa_round_id, name, round_order, lock_at, unlock_at, first_match_starts_at, last_match_ends_at)
values
  ('00000000-0000-0000-0000-000000007101', -1999999710, -1999999711, 'Teaser upgrade 1', 1, now() + interval '1 hour', now() + interval '2 days', now() + interval '2 hours', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000007102', -1999999710, -1999999712, 'Teaser upgrade 2', 2, now() + interval '3 days', now() + interval '4 days', now() + interval '74 hours', now() + interval '75 hours'),
  ('00000000-0000-0000-0000-000000007103', -1999999710, -1999999713, 'Teaser upgrade 3', 3, now() + interval '6 days', now() + interval '7 days', now() + interval '146 hours', now() + interval '147 hours');
update public.competition_publication set enabled = true;
update public.competition_publication set teaser = case
  when gameweek_id = '00000000-0000-0000-0000-000000007102' then null
  else 'Operator copy 👀' end where gameweek_id is not null;
insert into public.homepage_banners (gameweek_id, title, prize_title, content_ready)
values ('00000000-0000-0000-0000-000000007101', 'Preserved competition', 'Preserved prize', false);
create temp table before_banner as select to_jsonb(b) as row from public.homepage_banners b;
create temp table before_switches as select to_jsonb(p) - 'teaser' as row from public.competition_publication p;

__MIGRATION__

do $test$ begin
  if exists (select 1 from before_banner old where not exists (
    select 1 from public.homepage_banners b where to_jsonb(b) - 'teaser' = old.row)) then
    raise exception 'Moving teaser changed existing prize fields or rule binding'; end if;
  if exists (select 1 from before_switches old where not exists (
    select 1 from public.competition_publication p where to_jsonb(p) = old.row)) then
    raise exception 'Moving teaser changed publication/winner choices'; end if;
  if (select teaser from public.homepage_banners where gameweek_id = '00000000-0000-0000-0000-000000007101')
    is distinct from 'Operator copy 👀' then raise exception 'Existing custom teaser lost'; end if;
  if (select teaser from public.homepage_banners where gameweek_id = '00000000-0000-0000-0000-000000007102')
    is not null then raise exception 'A cleared teaser was replaced by a default'; end if;
  if not exists (select 1 from public.homepage_banners
    where gameweek_id = '00000000-0000-0000-0000-000000007103' and teaser = 'Operator copy 👀' and not content_ready) then
    raise exception 'Missing banner was not created safely'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'competition_publication' and column_name = 'teaser') then
    raise exception 'Old teaser column remains'; end if;
end; $test$;
set local role anon;
do $test$ begin
  if (select count(*) from public.get_public_gameweek_teasers()) <> 3 then
    raise exception 'Public teaser projection missing rounds'; end if;
  if exists (select 1 from public.homepage_banners where gameweek_id = '00000000-0000-0000-0000-000000007103') then
    raise exception 'Teaser projection exposed an unready banner'; end if;
end; $test$;
reset role;
rollback;

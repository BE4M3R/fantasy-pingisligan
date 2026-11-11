-- Executed only inside the disposable migration-validation stack; all data and
-- role changes roll back, including approved immutable document versions.
begin;
do $test$ begin
  if public.competitions_enabled() then raise exception 'Feature must be unpublished after migration'; end if;
  if (select enabled from public.competition_publication where id = 'season') then
    raise exception 'Season prize competition must be opt-in by default'; end if;
end; $test$;
update public.competition_publication set enabled = true where id in ('global', 'season');
insert into public.fantasy_gameweeks (id, stupa_stage_id, stupa_round_id, name,
  round_order, lock_at, unlock_at, first_match_starts_at, last_match_ends_at)
values
  ('00000000-0000-0000-0000-000000004001', -1999999500, -1999999501, 'Rules test 1', 4001,
   now() + interval '1 hour', now() + interval '2 days', now() + interval '3 hours', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000004002', -1999999500, -1999999502, 'Rules test 2', 4002,
   now() + interval '3 days', now() + interval '5 days', now() + interval '4 days', now() + interval '4 days');
do $test$ begin
  if exists (select 1 from public.competition_publication where gameweek_id is not null and enabled) then
    raise exception 'Prize Gameweeks must be opt-in by default'; end if;
end; $test$;
update public.competition_publication set enabled = true where gameweek_id in
  ('00000000-0000-0000-0000-000000004001', '00000000-0000-0000-0000-000000004002');
insert into public.competition_rules (id, kind, version, title, body) values
  ('00000000-0000-0000-0000-000000004101', 'gameweek', 4001, 'Weekly rules v1', 'First approved weekly terms');
insert into public.homepage_banners (id, gameweek_id, content_ready, sponsor)
values ('00000000-0000-0000-0000-000000004201', '00000000-0000-0000-0000-000000004001', true,
  'Visible partner');

set local role anon;
do $test$ begin
  if exists (select 1 from public.competition_rules) then raise exception 'Draft rules leaked'; end if;
  if (select rules_markdown from public.get_public_competition('00000000-0000-0000-0000-000000004001')) is not null then
    raise exception 'Draft terms were automatically published';
  end if;
  begin
    insert into public.competition_rules (kind, version, title, body, approved_at)
    values ('gameweek', 9999, 'Forbidden', 'Forbidden', now());
    raise exception 'Anonymous rules write succeeded';
  exception when insufficient_privilege then null; end;
end; $test$;
reset role;

update public.competition_rules set approved_at = now() where id = '00000000-0000-0000-0000-000000004101';
do $test$ begin
  if (select rules_version_id from public.homepage_banners where id = '00000000-0000-0000-0000-000000004201')
    <> '00000000-0000-0000-0000-000000004101'::uuid then raise exception 'Existing ready prize did not bind first approval'; end if;
  begin
    update public.competition_rules set body = 'Rewritten history' where id = '00000000-0000-0000-0000-000000004101';
    raise exception 'Approved body changed';
  exception when others then if sqlerrm not like 'Approved competition rules are immutable%' then raise; end if; end;
  begin
    delete from public.competition_rules where id = '00000000-0000-0000-0000-000000004101';
    raise exception 'Approved version deleted';
  exception when others then if sqlerrm not like 'Approved competition rules are immutable%' then raise; end if; end;
end; $test$;

insert into public.competition_rules (id, kind, version, title, body, approved_at) values
  ('00000000-0000-0000-0000-000000004102', 'gameweek', 4002, 'Weekly rules v2', 'Future weekly terms', now()),
  ('00000000-0000-0000-0000-000000004103', 'season', 4001, 'Season rules', 'Separate season terms', now());
insert into public.competition_rules (id, kind, version, title, body) values
  ('00000000-0000-0000-0000-000000004104', 'gameweek', 4003, 'Unapproved latest draft', 'Private draft terms');
-- A shared policy is published by approval, even before any prize references it.
set local role anon;
do $test$ begin
  if (select version from public.get_current_competition_rules() where kind = 'gameweek') is distinct from 4002 then
    raise exception 'Latest approved unbound Gameweek policy is missing or a draft replaced it'; end if;
  if (select count(*) from public.get_current_competition_rules()) <> 2 then
    raise exception 'Shared rules must return one policy per enabled kind'; end if;
end; $test$;
reset role;
insert into public.homepage_banners (id, gameweek_id, content_ready, sponsor) values
  ('00000000-0000-0000-0000-000000004202', '00000000-0000-0000-0000-000000004002', true, 'Secret future partner');
insert into public.homepage_banners (id, kind, published, publish_at) values
  ('00000000-0000-0000-0000-000000004203', 'season', true, now() + interval '1 day');
do $test$ begin
  if (select rules_version_id from public.homepage_banners where id = '00000000-0000-0000-0000-000000004201')
    <> '00000000-0000-0000-0000-000000004101'::uuid then raise exception 'Approval changed historical version'; end if;
  if (select rules_version_id from public.homepage_banners where id = '00000000-0000-0000-0000-000000004202')
    <> '00000000-0000-0000-0000-000000004102'::uuid then raise exception 'Future prize did not reuse latest approval'; end if;
  begin
    update public.homepage_banners set rules_version_id = '00000000-0000-0000-0000-000000004102'
    where id = '00000000-0000-0000-0000-000000004201';
    raise exception 'Competition rules reassigned';
  exception when others then if sqlerrm not like 'This competition retains%' then raise; end if; end;
  begin
    insert into public.homepage_banners (kind, published, rules_version_id)
    values ('season', false, '00000000-0000-0000-0000-000000004101');
    raise exception 'Wrong kind bound';
  exception when others then if sqlerrm not like 'Choose an approved rules version%' then raise; end if; end;
end; $test$;

set local role anon;
do $test$ begin
  if (select count(*) from public.competition_rules) <> 1 then raise exception 'Unrevealed rule versions leaked'; end if;
  if (select rules_markdown from public.get_public_competition('00000000-0000-0000-0000-000000004001')) <> 'First approved weekly terms' then
    raise exception 'Incorrect public approved terms'; end if;
  if (select rules_markdown from public.get_public_competition('00000000-0000-0000-0000-000000004002')) is not null then
    raise exception 'Future terms leaked through detail'; end if;
end; $test$;
reset role;
update public.homepage_banners set publish_at = now() - interval '1 minute' where id = '00000000-0000-0000-0000-000000004203';
set local role anon;
do $test$ begin
  if (select rules_markdown from public.get_public_competition(null)) <> 'Separate season terms' then
    raise exception 'Season did not use its own approved rules'; end if;
end; $test$;
reset role;
update public.competition_publication set enabled = false where id = 'season';
set local role anon;
do $test$ begin
  if exists (select 1 from public.get_public_competition(null)) then
    raise exception 'Disabled season page leaked'; end if;
  if exists (select 1 from public.competition_rules where kind = 'season') then
    raise exception 'Disabled season terms leaked'; end if;
  if exists (select 1 from public.get_current_competition_rules() where kind = 'season') then
    raise exception 'Disabled season shared policy leaked'; end if;
  if (select version from public.get_current_competition_rules() where kind = 'gameweek') is distinct from 4002 then
    raise exception 'Season toggle hid the current Gameweek policy'; end if;
  if exists (select 1 from public.homepage_banners where kind = 'season') then
    raise exception 'Disabled season prize leaked'; end if;
  if (select rules_markdown from public.get_public_competition('00000000-0000-0000-0000-000000004001')) <> 'First approved weekly terms' then
    raise exception 'Season toggle hid weekly terms'; end if;
end; $test$;
reset role;
update public.competition_publication set enabled = true where id = 'season';
set local role anon;
do $test$ begin
  if (select rules_markdown from public.get_public_competition(null)) <> 'Separate season terms' then
    raise exception 'Season toggle did not restore its approved terms'; end if;
end; $test$;
reset role;
update public.competition_publication set enabled = false where id in ('global', 'season');
set local role anon;
do $test$ begin
  if exists (select 1 from public.competition_rules) then raise exception 'Approved rules leaked before feature launch'; end if;
  if exists (select 1 from public.get_current_competition_rules()) then
    raise exception 'Shared policies leaked before feature launch'; end if;
  if exists (select 1 from public.homepage_banners) then raise exception 'Ready banners leaked before feature launch'; end if;
  if exists (select 1 from public.get_public_competition('00000000-0000-0000-0000-000000004001')) then
    raise exception 'Unlaunched competition RPC leaked'; end if;
end; $test$;
reset role;
rollback;

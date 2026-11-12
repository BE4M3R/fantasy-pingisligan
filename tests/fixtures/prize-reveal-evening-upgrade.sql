-- Disposable rollback-only check: the real migration must preserve editor
-- choices and calculate 18:00 correctly across both Stockholm DST changes.
begin;
create or replace function private.gameweek_prize_reveal_defaults()
returns table (gameweek_id uuid, prize_reveal_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.id, lag(g.unlock_at) over (order by g.lock_at, g.id)
  from public.fantasy_gameweeks g;
$$;
create temp table evening_upgrade_weeks as
with transitions as (
  select date '2099-03-31' - extract(dow from date '2099-03-31')::integer as spring,
    date '2099-10-31' - extract(dow from date '2099-10-31')::integer as autumn
), dates as (
  select i, case when i = 1 then spring - 1 else autumn + i - 3 end as ends_on
  from transitions cross join generate_series(1, 6) i
)
select i, md5('prize-evening-upgrade-' || i)::uuid as id,
  (ends_on + time '23:30') at time zone 'Europe/Stockholm' as ends_at
from dates;
insert into public.fantasy_gameweeks (id, stupa_stage_id, stupa_round_id, name,
  round_order, lock_at, unlock_at, first_match_starts_at, last_match_ends_at)
select id, -1999999800, -1999999800 - i, 'Evening upgrade ' || i,
  i, ends_at - interval '2 hours',
  (((ends_at at time zone 'Europe/Stockholm')::date + 1)::timestamp) at time zone 'Europe/Stockholm',
  ends_at - interval '1 hour', ends_at
from evening_upgrade_weeks;
update public.homepage_banners set prize_reveal_at = case
  when gameweek_id = md5('prize-evening-upgrade-4')::uuid then '2099-12-10T12:00:00Z'::timestamptz
  when gameweek_id = md5('prize-evening-upgrade-5')::uuid then now() - interval '1 day'
  else null end
where gameweek_id in (select id from evening_upgrade_weeks where i >= 4);
create temp table before_evening_upgrade as
select to_jsonb(b) as row from public.homepage_banners b;

__MIGRATION__

do $test$ begin
  if exists (select 1 from before_evening_upgrade old where not exists (
    select 1 from public.homepage_banners b where
      to_jsonb(b) - array['prize_reveal_at', 'updated_at'] = old.row - array['prize_reveal_at', 'updated_at']
      and ((b.gameweek_id in (select id from evening_upgrade_weeks where i in (2, 3)))
        or to_jsonb(b) = old.row)
  )) then raise exception 'Evening migration changed custom, cleared or past dates, or editorial content'; end if;
  if exists (
    select 1 from public.homepage_banners b
    join evening_upgrade_weeks w on w.id = b.gameweek_id
    join evening_upgrade_weeks previous on previous.i = w.i - 1
    where w.i in (2, 3) and (
      b.prize_reveal_at at time zone 'Europe/Stockholm' is distinct from
        (((previous.ends_at at time zone 'Europe/Stockholm')::date + 1) + time '18:00')
      or extract(hour from b.prize_reveal_at at time zone 'UTC') <> case when w.i = 2 then 16 else 17 end
    )
  ) then raise exception 'Evening defaults failed a Stockholm DST transition'; end if;
end; $test$;
rollback;

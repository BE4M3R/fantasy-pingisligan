-- Run inside a transaction and roll it back after these checks.
do $$
declare
  early_gameweek uuid;
  later_gameweek uuid;
  winter_gameweek uuid;
  spring_gameweek uuid;
  late_gameweek uuid;
  production_gameweek uuid;
  request_id bigint;
  request_body jsonb;
begin
  insert into public.fantasy_gameweeks (
    stupa_stage_id, stupa_round_id, name, first_match_starts_at,
    last_match_ends_at, lock_at, unlock_at
  ) values (
    -999001, -999001, 'Results dispatch test', '2026-09-21 10:00+00',
    '2026-09-23 20:00+00', '2026-09-21 08:00+00', '2026-09-23 22:00+00'
  ) returning id into early_gameweek;

  insert into public.fantasy_gameweeks (
    stupa_stage_id, stupa_round_id, name, first_match_starts_at,
    last_match_ends_at, lock_at, unlock_at
  ) values (
    -999002, -999002, 'Single match dispatch test', '2026-09-21 12:00+00',
    '2026-09-21 14:00+00', '2026-09-21 10:00+00', '2026-09-21 22:00+00'
  ) returning id into later_gameweek;

  insert into public.matches (stupa_stage_id, fantasy_gameweek_id, starts_at, ends_at, status)
  values
    (-999001, early_gameweek, '2026-09-21 10:00+00', '2026-09-21 12:00+00', 'scheduled'),
    (-999001, early_gameweek, '2026-09-21 18:00+00', '2026-09-21 20:00+00', 'scheduled'),
    (-999001, early_gameweek, '2026-09-23 17:00+00', '2026-09-23 19:00+00', 'scheduled'),
    (-999002, later_gameweek, '2026-09-21 12:00+00', '2026-09-21 14:00+00', 'scheduled'),
    (-999002, later_gameweek, '2026-09-21 18:00+00', '2026-09-21 20:00+00', 'cancelled');

  if public.results_refresh_window_active('2026-09-21 09:52+00', -999001)
     or not public.results_refresh_window_active('2026-09-21 10:07+00', -999001)
     or not public.results_refresh_window_active('2026-09-21 15:07+00', -999001)
     or not public.results_refresh_window_active('2026-09-21 21:52+00', -999001)
     or not public.results_refresh_window_active('2026-09-21 22:07+00', -999001)
     or public.results_refresh_window_active('2026-09-21 23:07+00', -999001)
     or public.results_refresh_window_active('2026-09-22 18:07+00', -999001)
     or not public.results_refresh_window_active('2026-09-23 17:07+00', -999001)
     or public.results_refresh_window_active('2026-09-24 18:07+00', -999001) then
    raise exception 'The multi-day match window did not match the expected Stockholm schedule.';
  end if;

  if not public.results_refresh_window_active('2026-09-21 16:52+00', -999002)
     or public.results_refresh_window_active('2026-09-21 17:00+00', -999002) then
    raise exception 'The five-hour cutoff or canceled-match filter is incorrect.';
  end if;

  insert into public.fantasy_gameweeks (
    stupa_stage_id, stupa_round_id, name, first_match_starts_at,
    last_match_ends_at, lock_at, unlock_at
  ) values (
    -999006, -999006, 'Late dispatch test', '2026-09-21 21:00+00',
    '2026-09-21 23:00+00', '2026-09-21 19:00+00', '2026-09-22 04:00+00'
  ) returning id into late_gameweek;
  insert into public.matches (stupa_stage_id, fantasy_gameweek_id, starts_at, ends_at)
  values (-999006, late_gameweek, '2026-09-21 21:00+00', '2026-09-21 23:00+00');
  if not public.results_refresh_window_active('2026-09-22 00:22+00', -999006)
     or not public.results_refresh_window_active('2026-09-22 01:52+00', -999006)
     or public.results_refresh_window_active('2026-09-22 02:07+00', -999006) then
    raise exception 'A late fixture must remain active for five hours across midnight.';
  end if;

  insert into public.fantasy_gameweeks (
    stupa_stage_id, stupa_round_id, name, first_match_starts_at,
    last_match_ends_at, lock_at, unlock_at
  ) values (
    -999004, -999004, 'Winter midnight dispatch test', '2026-12-20 23:00+00',
    '2026-12-21 01:00+00', '2026-12-20 21:00+00', '2026-12-21 23:00+00'
  ) returning id into winter_gameweek;
  insert into public.matches (stupa_stage_id, fantasy_gameweek_id, starts_at, ends_at)
  values (-999004, winter_gameweek, '2026-12-20 23:00+00', '2026-12-21 01:00+00');
  if not public.results_refresh_window_active('2026-12-20 23:22+00', -999004)
     or public.results_refresh_window_active('2026-12-21 23:07+00', -999004) then
    raise exception 'The winter Stockholm date boundary is incorrect.';
  end if;

  insert into public.fantasy_gameweeks (
    stupa_stage_id, stupa_round_id, name, first_match_starts_at,
    last_match_ends_at, lock_at, unlock_at
  ) values (
    -999005, -999005, 'Spring clock dispatch test', '2026-03-29 00:30+00',
    '2026-03-29 03:00+00', '2026-03-28 22:30+00', '2026-03-29 22:00+00'
  ) returning id into spring_gameweek;
  insert into public.matches (stupa_stage_id, fantasy_gameweek_id, starts_at, ends_at)
  values (-999005, spring_gameweek, '2026-03-29 00:30+00', '2026-03-29 03:00+00');
  if not public.results_refresh_window_active('2026-03-29 01:37+00', -999005)
     or public.results_refresh_window_active('2026-03-29 05:30+00', -999005) then
    raise exception 'The spring clock transition or five-hour cutoff is incorrect.';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'dispatch-results-refresh'
      and schedule = '7,22,37,52 * * * *'
  ) then
    raise exception 'The match-window Supabase Cron job was not installed.';
  end if;

  if exists (select 1 from vault.decrypted_secrets where name = 'results_dispatch_github_token') then
    raise exception 'The local test database must not contain the production dispatch token.';
  end if;
  perform vault.create_secret('local-test-token', 'results_dispatch_github_token');
  insert into public.fantasy_gameweeks (
    stupa_stage_id, stupa_round_id, name, first_match_starts_at,
    last_match_ends_at, lock_at, unlock_at
  ) values (
    5727, -999003, 'Real-stage dispatch test', '2026-09-21 10:00+00',
    '2026-09-21 12:00+00', '2026-09-21 08:00+00', '2026-09-21 22:00+00'
  ) returning id into production_gameweek;
  insert into public.matches (stupa_stage_id, fantasy_gameweek_id, starts_at, ends_at, status)
  values (5727, production_gameweek, '2026-09-21 10:00+00', '2026-09-21 12:00+00', 'scheduled');

  request_id := private.dispatch_results_refresh_if_due('2026-09-21 10:07+00');
  if request_id is null then
    raise exception 'A match-window dispatch was not queued.';
  end if;
  select convert_from(body, 'UTF8')::jsonb into request_body
  from net.http_request_queue
  where id = request_id;
  if request_body->>'ref' is distinct from 'main'
     or request_body->'inputs'->>'kind' is distinct from 'poll'
     or (request_body->'inputs'->>'slot_at')::timestamptz
        is distinct from '2026-09-21 10:07+00'::timestamptz then
    raise exception 'The queued GitHub dispatch did not preserve its polling slot.';
  end if;
end;
$$;

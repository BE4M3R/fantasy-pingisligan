-- Keep the GitHub Actions schedule nightly. Supabase checks the real fixture
-- window at quarter-hour slots and starts an Actions run only when it is due.
create schema if not exists extensions;
create schema if not exists vault;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
create schema if not exists private;
revoke all on schema private from public;

create index if not exists matches_stage_starts_at_for_results_refresh
on public.matches (stupa_stage_id, starts_at)
where fantasy_gameweek_id is not null;

create function public.results_refresh_window_active(
  p_at timestamptz,
  p_stage_id integer
)
returns boolean
language sql
stable
set search_path = ''
as $$
  with stockholm_days as (
    select (p_at at time zone 'Europe/Stockholm')::date + day_offset as local_date
    from (values (0), (-1)) as days(day_offset)
  ), day_bounds as (
    select
      local_date::timestamp at time zone 'Europe/Stockholm' as day_start,
      (local_date + 1)::timestamp at time zone 'Europe/Stockholm' as day_end
    from stockholm_days
  ), fixture_window as (
    select day_bounds.day_start,
           min(matches.starts_at) as first_start,
           max(matches.starts_at) as last_start
    from public.matches as matches
    join day_bounds on matches.starts_at >= day_bounds.day_start
      and matches.starts_at < day_bounds.day_end
    where matches.stupa_stage_id = p_stage_id
      and matches.fantasy_gameweek_id is not null
      and lower(matches.status) not in ('cancelled', 'canceled', 'postponed', 'deleted')
    group by day_bounds.day_start
  )
  select coalesce(bool_or(
    p_at >= fixture_window.first_start
      and p_at < fixture_window.last_start + interval '5 hours'
  ), false)
  from fixture_window;
$$;

revoke all on function public.results_refresh_window_active(timestamptz, integer)
from public, anon, authenticated;
grant execute on function public.results_refresh_window_active(timestamptz, integer)
to service_role;

-- Add results_dispatch_github_token only to production Supabase Vault. Its
-- absence keeps staging and local Cron checks read-only.
create function private.dispatch_results_refresh_if_due(p_at timestamptz default now())
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  github_token text;
begin
  -- The separate GitHub nightly trigger already imports at 00:07 Stockholm.
  if extract(hour from p_at at time zone 'Europe/Stockholm') = 0
     and extract(minute from p_at at time zone 'Europe/Stockholm') < 15 then
    return null;
  end if;

  if not public.results_refresh_window_active(p_at, 5727) then
    return null;
  end if;

  select decrypted_secret into github_token
  from vault.decrypted_secrets
  where name = 'results_dispatch_github_token';
  if github_token is null or github_token = '' then
    return null;
  end if;

  return net.http_post(
    url := 'https://api.github.com/repos/BE4M3R/fantasy-pingisligan/actions/workflows/import-results.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('kind', 'poll', 'slot_at', p_at)),
    headers := jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'Authorization', 'Bearer ' || github_token,
      'X-GitHub-Api-Version', '2026-03-10',
      'User-Agent', 'fantasy-pingisligan-results-dispatcher'
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function private.dispatch_results_refresh_if_due(timestamptz)
from public, anon, authenticated, service_role;

select cron.schedule(
  'dispatch-results-refresh',
  '7,22,37,52 * * * *',
  $cron$select private.dispatch_results_refresh_if_due();$cron$
);

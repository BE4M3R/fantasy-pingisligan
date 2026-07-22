-- Add once-per-season chips and snapshot the selected chip at gameweek lock.

create extension if not exists pg_cron;

create table if not exists public.fantasy_team_chip_selections (
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  fantasy_gameweek_id uuid not null references public.fantasy_gameweeks(id) on delete cascade,
  chip text not null,
  selected_at timestamptz not null default now(),
  locked_at timestamptz,
  used_at timestamptz,
  primary key (fantasy_team_id, fantasy_gameweek_id),
  constraint fantasy_team_chip_selections_chip_check
    check (chip in ('wildcard', 'triple_captain', 'bench_boost'))
);

create unique index if not exists fantasy_team_chip_selections_once_locked
on public.fantasy_team_chip_selections (fantasy_team_id, chip)
where locked_at is not null;

create index if not exists fantasy_team_chip_selections_gameweek_idx
on public.fantasy_team_chip_selections (fantasy_gameweek_id, fantasy_team_id);

alter table public.fantasy_team_chip_selections enable row level security;

drop policy if exists "Users can read their chip selections" on public.fantasy_team_chip_selections;
create policy "Users can read their chip selections"
on public.fantasy_team_chip_selections for select
to authenticated
using (
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_chip_selections.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
);

drop policy if exists "Users can select upcoming chips" on public.fantasy_team_chip_selections;
create policy "Users can select upcoming chips"
on public.fantasy_team_chip_selections for insert
to authenticated
with check (
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_chip_selections.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.fantasy_gameweeks
    where fantasy_gameweeks.id = fantasy_team_chip_selections.fantasy_gameweek_id
      and now() < fantasy_gameweeks.lock_at
  )
);

drop policy if exists "Users can update upcoming chip selections" on public.fantasy_team_chip_selections;
create policy "Users can update upcoming chip selections"
on public.fantasy_team_chip_selections for update
to authenticated
using (
  locked_at is null
  and exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_chip_selections.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.fantasy_gameweeks
    where fantasy_gameweeks.id = fantasy_team_chip_selections.fantasy_gameweek_id
      and now() < fantasy_gameweeks.lock_at
  )
)
with check (
  locked_at is null
  and exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_chip_selections.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.fantasy_gameweeks
    where fantasy_gameweeks.id = fantasy_team_chip_selections.fantasy_gameweek_id
      and now() < fantasy_gameweeks.lock_at
  )
);

drop policy if exists "Users can clear upcoming chip selections" on public.fantasy_team_chip_selections;
create policy "Users can clear upcoming chip selections"
on public.fantasy_team_chip_selections for delete
to authenticated
using (
  locked_at is null
  and exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_chip_selections.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.fantasy_gameweeks
    where fantasy_gameweeks.id = fantasy_team_chip_selections.fantasy_gameweek_id
      and now() < fantasy_gameweeks.lock_at
  )
);

alter table public.fantasy_team_gameweek_snapshots
  add column if not exists active_chip text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fantasy_team_gameweek_snapshots_active_chip_check'
  ) then
    alter table public.fantasy_team_gameweek_snapshots
      add constraint fantasy_team_gameweek_snapshots_active_chip_check
      check (active_chip is null or active_chip in ('wildcard', 'triple_captain', 'bench_boost'));
  end if;
end;
$$;

create or replace function public.snapshot_locked_squads()
returns table (
  locked_gameweeks integer,
  new_team_snapshots integer,
  new_player_snapshots integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_gameweek_count integer;
  team_snapshot_count integer;
  player_snapshot_count integer;
begin
  select count(*)::integer
  into locked_gameweek_count
  from public.fantasy_gameweeks
  where now() >= lock_at
    and now() <= unlock_at;

  insert into public.fantasy_team_gameweek_snapshots (
    fantasy_team_id,
    fantasy_gameweek_id,
    team_name_at_lock,
    budget_at_lock,
    active_chip
  )
  select
    fantasy_teams.id,
    fantasy_gameweeks.id,
    fantasy_teams.name,
    fantasy_teams.budget,
    chip_selections.chip
  from public.fantasy_gameweeks
  cross join public.fantasy_teams
  left join public.fantasy_team_chip_selections as chip_selections
    on chip_selections.fantasy_team_id = fantasy_teams.id
    and chip_selections.fantasy_gameweek_id = fantasy_gameweeks.id
    and chip_selections.locked_at is null
  where now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at
    and fantasy_teams.created_at <= fantasy_gameweeks.lock_at
  on conflict (fantasy_team_id, fantasy_gameweek_id) do nothing;

  get diagnostics team_snapshot_count = row_count;

  update public.fantasy_team_gameweek_snapshots as snapshots
  set active_chip = chip_selections.chip
  from public.fantasy_team_chip_selections as chip_selections
  join public.fantasy_gameweeks
    on fantasy_gameweeks.id = chip_selections.fantasy_gameweek_id
  where snapshots.fantasy_team_id = chip_selections.fantasy_team_id
    and snapshots.fantasy_gameweek_id = chip_selections.fantasy_gameweek_id
    and snapshots.active_chip is null
    and chip_selections.locked_at is null
    and now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at;

  update public.fantasy_team_chip_selections as chip_selections
  set locked_at = now()
  from public.fantasy_gameweeks
  where fantasy_gameweeks.id = chip_selections.fantasy_gameweek_id
    and chip_selections.locked_at is null
    and now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at;

  insert into public.fantasy_team_gameweek_players (
    fantasy_team_id,
    fantasy_gameweek_id,
    player_id,
    club_id_at_lock,
    player_first_name_at_lock,
    player_last_name_at_lock,
    club_name_at_lock,
    position,
    is_captain,
    price_at_lock
  )
  select
    snapshots.fantasy_team_id,
    snapshots.fantasy_gameweek_id,
    squad.player_id,
    players.club_id,
    players.first_name,
    players.last_name,
    clubs.name,
    squad.position,
    squad.is_captain,
    players.price
  from public.fantasy_team_gameweek_snapshots as snapshots
  join public.fantasy_gameweeks
    on fantasy_gameweeks.id = snapshots.fantasy_gameweek_id
  join public.fantasy_team_players as squad
    on squad.fantasy_team_id = snapshots.fantasy_team_id
  join public.players
    on players.id = squad.player_id
  left join public.clubs
    on clubs.id = players.club_id
  where now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at
  on conflict (fantasy_team_id, fantasy_gameweek_id, player_id) do nothing;

  get diagnostics player_snapshot_count = row_count;

  return query
  select locked_gameweek_count, team_snapshot_count, player_snapshot_count;
end;
$$;

revoke all on function public.snapshot_locked_squads() from public;
grant execute on function public.snapshot_locked_squads() to service_role;

create or replace function public.mark_used_chips()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  used_chip_count integer;
begin
  update public.fantasy_team_chip_selections as chip_selections
  set used_at = now()
  from public.fantasy_gameweeks
  where fantasy_gameweeks.id = chip_selections.fantasy_gameweek_id
    and chip_selections.locked_at is not null
    and chip_selections.used_at is null
    and now() > fantasy_gameweeks.unlock_at;

  get diagnostics used_chip_count = row_count;

  return used_chip_count;
end;
$$;

revoke all on function public.mark_used_chips() from public;
grant execute on function public.mark_used_chips() to service_role;

create or replace function public.calculate_fantasy_gameweek_points(target_gameweek_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_team_count integer;
begin
  with player_points as (
    select
      matches.fantasy_gameweek_id,
      player_match_stats.player_id,
      sum(player_match_stats.fantasy_points)::integer as points
    from public.player_match_stats
    join public.matches
      on matches.id = player_match_stats.match_id
    where matches.fantasy_gameweek_id = target_gameweek_id
    group by matches.fantasy_gameweek_id, player_match_stats.player_id
  )
  update public.fantasy_team_gameweek_players as snapshot_players
  set fantasy_points = coalesce(player_points.points, 0)
  from player_points
  where snapshot_players.fantasy_gameweek_id = player_points.fantasy_gameweek_id
    and snapshot_players.player_id = player_points.player_id;

  update public.fantasy_team_gameweek_players
  set fantasy_points = 0
  where fantasy_gameweek_id = target_gameweek_id
    and fantasy_points is null;

  insert into public.fantasy_team_gameweek_points (
    fantasy_team_id,
    fantasy_gameweek_id,
    points,
    calculated_at,
    updated_at
  )
  select
    snapshots.fantasy_team_id,
    snapshots.fantasy_gameweek_id,
    coalesce(
      sum(
        case
          when snapshot_players.position = 'bench'
            and snapshots.active_chip is distinct from 'bench_boost' then 0
          when snapshot_players.is_captain
            and snapshot_players.position = 'starter'
            and snapshots.active_chip = 'triple_captain'
            then coalesce(snapshot_players.fantasy_points, 0) * 3
          when snapshot_players.is_captain
            and snapshot_players.position = 'starter'
            then coalesce(snapshot_players.fantasy_points, 0) * 2
          else coalesce(snapshot_players.fantasy_points, 0)
        end
      ),
      0
    )::integer as points,
    now(),
    now()
  from public.fantasy_team_gameweek_snapshots as snapshots
  left join public.fantasy_team_gameweek_players as snapshot_players
    on snapshot_players.fantasy_team_id = snapshots.fantasy_team_id
    and snapshot_players.fantasy_gameweek_id = snapshots.fantasy_gameweek_id
  where snapshots.fantasy_gameweek_id = target_gameweek_id
  group by snapshots.fantasy_team_id, snapshots.fantasy_gameweek_id
  on conflict (fantasy_team_id, fantasy_gameweek_id) do update
  set points = excluded.points,
      calculated_at = excluded.calculated_at,
      updated_at = excluded.updated_at;

  get diagnostics updated_team_count = row_count;

  return updated_team_count;
end;
$$;

revoke all on function public.calculate_fantasy_gameweek_points(uuid) from public;
grant execute on function public.calculate_fantasy_gameweek_points(uuid) to service_role;

drop function if exists public.get_global_leaderboard();

create function public.get_global_leaderboard()
returns table (
  user_id uuid,
  team_name text,
  total_points bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    fantasy_teams.user_id,
    fantasy_teams.name as team_name,
    coalesce(sum(fantasy_team_gameweek_points.points), 0)::bigint as total_points
  from public.fantasy_teams
  left join public.fantasy_team_gameweek_points
    on fantasy_team_gameweek_points.fantasy_team_id = fantasy_teams.id
  where fantasy_teams.onboarding_completed
  group by fantasy_teams.user_id, fantasy_teams.name
  order by total_points desc, lower(fantasy_teams.name), fantasy_teams.user_id;
$$;

grant execute on function public.get_global_leaderboard() to authenticated;

create or replace function public.get_my_gameweek_progress()
returns table (
  gameweek_id uuid,
  gameweek_name text,
  round_order integer,
  first_match_starts_at timestamptz,
  last_match_ends_at timestamptz,
  lock_at timestamptz,
  unlock_at timestamptz,
  status text,
  points integer,
  active_chip text
)
language sql
stable
set search_path = public
as $$
  select
    fantasy_gameweeks.id as gameweek_id,
    fantasy_gameweeks.name as gameweek_name,
    fantasy_gameweeks.round_order,
    fantasy_gameweeks.first_match_starts_at,
    fantasy_gameweeks.last_match_ends_at,
    fantasy_gameweeks.lock_at,
    fantasy_gameweeks.unlock_at,
    case
      when now() > fantasy_gameweeks.unlock_at then 'Complete'
      when now() >= fantasy_gameweeks.first_match_starts_at then 'In progress'
      else 'Upcoming'
    end as status,
    coalesce(fantasy_team_gameweek_points.points, 0) as points,
    fantasy_team_gameweek_snapshots.active_chip
  from public.fantasy_gameweeks
  left join public.fantasy_teams
    on fantasy_teams.user_id = auth.uid()
  left join public.fantasy_team_gameweek_points
    on fantasy_team_gameweek_points.fantasy_gameweek_id = fantasy_gameweeks.id
    and fantasy_team_gameweek_points.fantasy_team_id = fantasy_teams.id
  left join public.fantasy_team_gameweek_snapshots
    on fantasy_team_gameweek_snapshots.fantasy_gameweek_id = fantasy_gameweeks.id
    and fantasy_team_gameweek_snapshots.fantasy_team_id = fantasy_teams.id
  order by fantasy_gameweeks.round_order, fantasy_gameweeks.first_match_starts_at;
$$;

grant execute on function public.get_my_gameweek_progress() to authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'mark-used-chips';

select cron.schedule(
  'mark-used-chips',
  '*/15 * * * *',
  $cron$select public.mark_used_chips();$cron$
);

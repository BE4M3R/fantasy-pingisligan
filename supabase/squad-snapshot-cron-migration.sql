-- Capture every eligible fantasy team's squad while a gameweek transfer window
-- is closed. Run transfer-window-lock-migration.sql before this migration.

create extension if not exists pg_cron;

create table if not exists public.fantasy_team_gameweek_snapshots (
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  fantasy_gameweek_id uuid not null references public.fantasy_gameweeks(id) on delete cascade,
  team_name_at_lock text not null,
  budget_at_lock numeric(12, 0) not null,
  snapshotted_at timestamptz not null default now(),
  primary key (fantasy_team_id, fantasy_gameweek_id)
);

create table if not exists public.fantasy_team_gameweek_players (
  fantasy_team_id uuid not null,
  fantasy_gameweek_id uuid not null,
  player_id uuid not null references public.players(id) on delete restrict,
  club_id_at_lock uuid references public.clubs(id) on delete set null,
  player_first_name_at_lock text not null,
  player_last_name_at_lock text not null,
  club_name_at_lock text,
  position text not null,
  is_captain boolean not null,
  price_at_lock numeric(12, 0) not null,
  fantasy_points integer,
  created_at timestamptz not null default now(),
  primary key (fantasy_team_id, fantasy_gameweek_id, player_id),
  foreign key (fantasy_team_id, fantasy_gameweek_id)
    references public.fantasy_team_gameweek_snapshots(fantasy_team_id, fantasy_gameweek_id)
    on delete cascade,
  constraint fantasy_team_gameweek_players_position_check
    check (position in ('starter', 'bench'))
);

create index if not exists fantasy_team_gameweek_snapshots_gameweek_idx
on public.fantasy_team_gameweek_snapshots (fantasy_gameweek_id, fantasy_team_id);

create index if not exists fantasy_team_gameweek_players_gameweek_idx
on public.fantasy_team_gameweek_players (fantasy_gameweek_id, fantasy_team_id);

create index if not exists fantasy_team_gameweek_players_player_idx
on public.fantasy_team_gameweek_players (fantasy_gameweek_id, player_id);

alter table public.fantasy_team_gameweek_snapshots enable row level security;
alter table public.fantasy_team_gameweek_players enable row level security;

create policy "Users can read their squad snapshots"
on public.fantasy_team_gameweek_snapshots for select
to authenticated
using (
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_gameweek_snapshots.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
);

create policy "Users can read their snapshotted players"
on public.fantasy_team_gameweek_players for select
to authenticated
using (
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_gameweek_players.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
);

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
    budget_at_lock
  )
  select
    fantasy_teams.id,
    fantasy_gameweeks.id,
    fantasy_teams.name,
    fantasy_teams.budget
  from public.fantasy_gameweeks
  cross join public.fantasy_teams
  where now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at
    and fantasy_teams.created_at <= fantasy_gameweeks.lock_at
  on conflict (fantasy_team_id, fantasy_gameweek_id) do nothing;

  get diagnostics team_snapshot_count = row_count;

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

-- Replace an existing job with the same name instead of creating a duplicate.
select cron.unschedule(jobid)
from cron.job
where jobname = 'snapshot-locked-squads';

select cron.schedule(
  'snapshot-locked-squads',
  '*/5 * * * *',
  $cron$select public.snapshot_locked_squads();$cron$
);

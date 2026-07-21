create extension if not exists pg_cron;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  profixio_id text unique,
  stupa_user_role_id integer unique,
  club_id uuid references public.clubs(id) on delete set null,
  first_name text not null,
  last_name text not null,
  birth_year integer,
  ranking_position integer,
  ranking_points integer,
  price numeric(12, 0) not null default 5000000,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  source_updated_at timestamptz
);

create table if not exists public.fantasy_teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  budget numeric(12, 0) not null default 100000000,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.fantasy_team_players (
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  position text not null default 'starter',
  is_captain boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (fantasy_team_id, player_id),
  constraint fantasy_team_players_position_check check (position in ('starter', 'bench'))
);

create unique index if not exists fantasy_team_players_one_captain
on public.fantasy_team_players (fantasy_team_id)
where is_captain;

create or replace function public.enforce_fantasy_team_club_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_club_id uuid;
  selected_club_count integer;
begin
  select players.club_id
  into selected_club_id
  from public.players
  where players.id = new.player_id;

  if selected_club_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)
    into selected_club_count
    from public.fantasy_team_players
    join public.players
      on players.id = fantasy_team_players.player_id
    where fantasy_team_players.fantasy_team_id = new.fantasy_team_id
      and fantasy_team_players.player_id <> old.player_id
      and players.club_id = selected_club_id;
  else
    select count(*)
    into selected_club_count
    from public.fantasy_team_players
    join public.players
      on players.id = fantasy_team_players.player_id
    where fantasy_team_players.fantasy_team_id = new.fantasy_team_id
      and players.club_id = selected_club_id;
  end if;

  if selected_club_count >= 2 then
    raise exception 'You can select a maximum of two players from the same club.'
      using errcode = '23514',
        constraint = 'fantasy_team_players_club_limit';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_fantasy_team_club_limit
on public.fantasy_team_players;

create trigger enforce_fantasy_team_club_limit
before insert or update of fantasy_team_id, player_id
on public.fantasy_team_players
for each row
execute function public.enforce_fantasy_team_club_limit();

create table if not exists public.fantasy_gameweeks (
  id uuid primary key default gen_random_uuid(),
  stupa_stage_id integer,
  stupa_event_id integer,
  stupa_event_category_id integer,
  stupa_round_id integer not null unique,
  name text not null,
  round_order integer,
  first_match_starts_at timestamptz not null,
  last_match_ends_at timestamptz not null,
  lock_at timestamptz not null,
  unlock_at timestamptz not null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fantasy_team_gameweek_points (
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  fantasy_gameweek_id uuid not null references public.fantasy_gameweeks(id) on delete cascade,
  points integer not null default 0,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (fantasy_team_id, fantasy_gameweek_id)
);

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

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 8)),
  created_at timestamptz not null default now()
);

create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, fantasy_team_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  profixio_id text unique,
  stupa_match_id integer,
  stupa_stage_id integer,
  fantasy_gameweek_id uuid references public.fantasy_gameweeks(id) on delete set null,
  stupa_event_match_id integer,
  stupa_event_id integer,
  stupa_event_category_id integer,
  stupa_round_id integer,
  stupa_group_id integer,
  home_club_id uuid references public.clubs(id) on delete set null,
  away_club_id uuid references public.clubs(id) on delete set null,
  home_team_name text,
  away_team_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  source_updated_at timestamptz
);

create unique index if not exists matches_stupa_match_id_key
on public.matches (stupa_match_id);

create table if not exists public.player_match_stats (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  won_matches integer not null default 0,
  lost_matches integer not null default 0,
  won_sets integer not null default 0,
  lost_sets integer not null default 0,
  fantasy_points integer not null default 0,
  created_at timestamptz not null default now(),
  unique (match_id, player_id)
);

create table if not exists public.stupa_submatches (
  stupa_submatch_id integer primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  match_order integer,
  status text not null,
  is_golden_match boolean not null default false,
  winning_team_stupa_id integer,
  raw_payload jsonb not null,
  source_updated_at timestamptz not null default now()
);

create table if not exists public.player_submatch_results (
  id uuid primary key default gen_random_uuid(),
  stupa_submatch_id integer not null references public.stupa_submatches(stupa_submatch_id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  stupa_user_role_id integer not null,
  stupa_license_id text,
  player_name text not null,
  team_stupa_participant_id integer not null,
  side_order integer,
  lineup_label text,
  won boolean not null,
  sets_won integer not null default 0,
  sets_lost integer not null default 0,
  points_won integer not null default 0,
  points_lost integer not null default 0,
  set_wins integer[] not null default '{}',
  set_points integer[] not null default '{}',
  walkover boolean not null default false,
  raw_payload jsonb not null,
  source_updated_at timestamptz not null default now(),
  unique (stupa_submatch_id, stupa_user_role_id)
);

alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.players enable row level security;
alter table public.fantasy_teams enable row level security;
alter table public.fantasy_team_players enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.matches enable row level security;
alter table public.player_match_stats enable row level security;
alter table public.stupa_submatches enable row level security;
alter table public.player_submatch_results enable row level security;
alter table public.fantasy_gameweeks enable row level security;
alter table public.fantasy_team_gameweek_points enable row level security;
alter table public.fantasy_team_gameweek_snapshots enable row level security;
alter table public.fantasy_team_gameweek_players enable row level security;

create policy "Profiles are readable by signed-in users"
on public.profiles for select
to authenticated
using (true);

create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Clubs are public"
on public.clubs for select
to anon, authenticated
using (true);

create policy "Players are public"
on public.players for select
to anon, authenticated
using (true);

create policy "Matches are public"
on public.matches for select
to anon, authenticated
using (true);

create policy "Player match stats are public"
on public.player_match_stats for select
to anon, authenticated
using (true);

create policy "Fantasy gameweeks are public"
on public.fantasy_gameweeks for select
to anon, authenticated
using (true);

create policy "Users can read their gameweek points"
on public.fantasy_team_gameweek_points for select
to authenticated
using (
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_gameweek_points.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
);

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

create policy "Users can read their fantasy team"
on public.fantasy_teams for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their fantasy team"
on public.fantasy_teams for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their fantasy team"
on public.fantasy_teams for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can read their squad"
on public.fantasy_team_players for select
to authenticated
using (
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_players.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
);

create policy "Users can manage their squad"
on public.fantasy_team_players for all
to authenticated
using (
  not exists (
    select 1
    from public.fantasy_gameweeks
    where now() >= lock_at
      and now() <= unlock_at
  )
  and
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_players.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
)
with check (
  not exists (
    select 1
    from public.fantasy_gameweeks
    where now() >= lock_at
      and now() <= unlock_at
  )
  and
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_players.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
);

create policy "Users can read leagues they own or joined"
on public.leagues for select
to authenticated
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from public.league_members
    join public.fantasy_teams on fantasy_teams.id = league_members.fantasy_team_id
    where league_members.league_id = leagues.id
      and fantasy_teams.user_id = auth.uid()
  )
);

create policy "Users can create leagues"
on public.leagues for insert
to authenticated
with check (owner_id = auth.uid());

create policy "Users can read memberships for their leagues"
on public.league_members for select
to authenticated
using (
  exists (
    select 1
    from public.leagues
    where leagues.id = league_members.league_id
      and leagues.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = league_members.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
);

create policy "Users can join leagues with their team"
on public.league_members for insert
to authenticated
with check (
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = league_members.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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
    coalesce(
      sum(
        case
          when fantasy_team_players.is_captain then player_match_stats.fantasy_points * 2
          else player_match_stats.fantasy_points
        end
      ),
      0
    )::bigint as total_points
  from public.fantasy_teams
  left join public.fantasy_team_players
    on fantasy_team_players.fantasy_team_id = fantasy_teams.id
  left join public.player_match_stats
    on player_match_stats.player_id = fantasy_team_players.player_id
  where fantasy_teams.onboarding_completed
  group by fantasy_teams.user_id, fantasy_teams.name
  order by total_points desc, lower(fantasy_teams.name), fantasy_teams.user_id;
$$;

grant execute on function public.get_global_leaderboard() to authenticated;

create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from auth.users
  where id = auth.uid();
end;
$$;

revoke all on function public.delete_current_user() from public;
grant execute on function public.delete_current_user() to authenticated;

create or replace function public.email_is_registered(candidate_email text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from auth.users
    where lower(email) = lower(candidate_email)
  );
$$;

revoke all on function public.email_is_registered(text) from public;
grant execute on function public.email_is_registered(text) to anon, authenticated;

create or replace function public.current_transfer_lock()
returns table (
  is_locked boolean,
  gameweek_id uuid,
  gameweek_name text,
  lock_at timestamptz,
  unlock_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    exists (
      select 1
      from public.fantasy_gameweeks
      where now() >= lock_at
        and now() <= unlock_at
    ) as is_locked,
    locked_gameweek.id as gameweek_id,
    locked_gameweek.name as gameweek_name,
    locked_gameweek.lock_at,
    locked_gameweek.unlock_at
  from (
    select *
    from public.fantasy_gameweeks
    where now() >= lock_at
      and now() <= unlock_at
    order by lock_at
    limit 1
  ) as locked_gameweek
  right join (select 1) as fallback on true;
$$;

grant execute on function public.current_transfer_lock() to anon, authenticated;

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
  points integer
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
    coalesce(fantasy_team_gameweek_points.points, 0) as points
  from public.fantasy_gameweeks
  left join public.fantasy_teams
    on fantasy_teams.user_id = auth.uid()
  left join public.fantasy_team_gameweek_points
    on fantasy_team_gameweek_points.fantasy_gameweek_id = fantasy_gameweeks.id
    and fantasy_team_gameweek_points.fantasy_team_id = fantasy_teams.id
  order by fantasy_gameweeks.round_order, fantasy_gameweeks.first_match_starts_at;
$$;

grant execute on function public.get_my_gameweek_progress() to authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'snapshot-locked-squads';

select cron.schedule(
  'snapshot-locked-squads',
  '*/5 * * * *',
  $cron$select public.snapshot_locked_squads();$cron$
);

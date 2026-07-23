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
  active_chip text,
  transfer_count_at_lock integer not null default 0,
  free_transfers_at_lock integer,
  free_transfers_after_lock integer not null default 1,
  transfer_penalty_points integer not null default 0,
  snapshotted_at timestamptz not null default now(),
  primary key (fantasy_team_id, fantasy_gameweek_id),
  constraint fantasy_team_gameweek_snapshots_active_chip_check
    check (active_chip is null or active_chip in ('wildcard', 'triple_captain', 'bench_boost'))
);

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
alter table public.fantasy_team_chip_selections enable row level security;

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
    coalesce(sum(fantasy_team_gameweek_points.points), 0)::bigint as total_points
  from public.fantasy_teams
  left join public.fantasy_team_gameweek_points
    on fantasy_team_gameweek_points.fantasy_team_id = fantasy_teams.id
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

create or replace function public.save_my_fantasy_team(
  p_gameweek_id uuid,
  p_squad jsonb,
  p_chip text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_team_id uuid;
  current_team_budget numeric;
  squad_count integer;
  distinct_player_count integer;
  starter_count integer;
  bench_count integer;
  captain_count integer;
  valid_player_count integer;
  squad_cost numeric;
  target_lock_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to save a team.';
  end if;

  select fantasy_teams.id, fantasy_teams.budget
  into current_team_id, current_team_budget
  from public.fantasy_teams
  where fantasy_teams.user_id = current_user_id
  for update;

  if current_team_id is null then
    raise exception 'Fantasy team not found.';
  end if;

  if exists (
    select 1
    from public.fantasy_gameweeks
    where now() >= lock_at
      and now() <= unlock_at
  ) then
    raise exception 'The transfer window is closed.';
  end if;

  if jsonb_typeof(p_squad) is distinct from 'array' then
    raise exception 'The squad must be an array.';
  end if;

  select
    count(*)::integer,
    count(distinct draft.player_id)::integer,
    count(*) filter (where draft.position = 'starter')::integer,
    count(*) filter (where draft.position = 'bench')::integer,
    count(*) filter (where draft.is_captain)::integer
  into
    squad_count,
    distinct_player_count,
    starter_count,
    bench_count,
    captain_count
  from jsonb_to_recordset(p_squad) as draft(
    player_id uuid,
    position text,
    is_captain boolean
  );

  if squad_count > 6 then
    raise exception 'A squad can contain at most six players.';
  end if;

  if distinct_player_count <> squad_count then
    raise exception 'A player can appear only once in a squad.';
  end if;

  if starter_count + bench_count <> squad_count then
    raise exception 'Every player must be a main or bench player.';
  end if;

  if starter_count > 4 or bench_count > 2 then
    raise exception 'A squad can contain at most four main and two bench players.';
  end if;

  if (squad_count = 0 and captain_count <> 0)
    or (squad_count > 0 and captain_count <> 1) then
    raise exception 'Choose exactly one captain.';
  end if;

  select count(*)::integer, coalesce(sum(players.price), 0)
  into valid_player_count, squad_cost
  from jsonb_to_recordset(p_squad) as draft(
    player_id uuid,
    position text,
    is_captain boolean
  )
  join public.players
    on players.id = draft.player_id
    and players.active;

  if valid_player_count <> squad_count then
    raise exception 'One or more selected players are unavailable.';
  end if;

  if squad_cost > current_team_budget then
    raise exception 'That squad exceeds the team budget.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_squad) as draft(
      player_id uuid,
      position text,
      is_captain boolean
    )
    join public.players
      on players.id = draft.player_id
    where players.club_id is not null
    group by players.club_id
    having count(*) > 2
  ) then
    raise exception 'You can select a maximum of two players from the same club.';
  end if;

  if p_chip is not null
    and p_chip not in ('wildcard', 'triple_captain', 'bench_boost') then
    raise exception 'Choose a valid chip.';
  end if;

  if p_gameweek_id is not null then
    select fantasy_gameweeks.lock_at
    into target_lock_at
    from public.fantasy_gameweeks
    where fantasy_gameweeks.id = p_gameweek_id;

    if target_lock_at is null then
      raise exception 'Gameweek not found.';
    end if;

    if now() >= target_lock_at then
      raise exception 'That gameweek is already locked.';
    end if;
  elsif p_chip is not null then
    raise exception 'No upcoming gameweek found for the selected chip.';
  end if;

  if p_chip is not null and exists (
    select 1
    from public.fantasy_team_chip_selections
    where fantasy_team_id = current_team_id
      and chip = p_chip
      and locked_at is not null
  ) then
    raise exception 'That chip has already been used this season.';
  end if;

  delete from public.fantasy_team_players
  where fantasy_team_id = current_team_id;

  insert into public.fantasy_team_players (
    fantasy_team_id,
    player_id,
    position,
    is_captain
  )
  select
    current_team_id,
    draft.player_id,
    draft.position,
    draft.is_captain
  from jsonb_to_recordset(p_squad) as draft(
    player_id uuid,
    position text,
    is_captain boolean
  );

  if p_gameweek_id is not null then
    delete from public.fantasy_team_chip_selections
    where fantasy_team_id = current_team_id
      and fantasy_gameweek_id = p_gameweek_id
      and locked_at is null;

    if p_chip is not null then
      insert into public.fantasy_team_chip_selections (
        fantasy_team_id,
        fantasy_gameweek_id,
        chip,
        selected_at
      )
      values (
        current_team_id,
        p_gameweek_id,
        p_chip,
        now()
      );
    end if;
  end if;
end;
$$;

revoke all on function public.save_my_fantasy_team(uuid, jsonb, text)
from public;

grant execute on function public.save_my_fantasy_team(uuid, jsonb, text)
to authenticated;

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
    budget_at_lock,
    active_chip,
    transfer_count_at_lock,
    free_transfers_at_lock,
    free_transfers_after_lock,
    transfer_penalty_points
  )
  select
    fantasy_teams.id,
    fantasy_gameweeks.id,
    fantasy_teams.name,
    fantasy_teams.budget,
    chip_selections.chip,
    coalesce(transfer_usage.transfer_count, 0),
    transfer_bank.free_transfers_at_lock,
    case
      when previous_snapshot.fantasy_gameweek_id is null then 1
      when chip_selections.chip = 'wildcard' then transfer_bank.free_transfers_at_lock
      else greatest(
        transfer_bank.free_transfers_at_lock - coalesce(transfer_usage.transfer_count, 0),
        0
      )
    end,
    case
      when previous_snapshot.fantasy_gameweek_id is null
        or chip_selections.chip = 'wildcard' then 0
      else greatest(
        coalesce(transfer_usage.transfer_count, 0) - transfer_bank.free_transfers_at_lock,
        0
      ) * -4
    end
  from public.fantasy_gameweeks
  cross join public.fantasy_teams
  left join public.fantasy_team_chip_selections as chip_selections
    on chip_selections.fantasy_team_id = fantasy_teams.id
    and chip_selections.fantasy_gameweek_id = fantasy_gameweeks.id
    and chip_selections.locked_at is null
  left join lateral (
    select
      previous_snapshots.fantasy_gameweek_id,
      previous_snapshots.free_transfers_after_lock
    from public.fantasy_team_gameweek_snapshots as previous_snapshots
    join public.fantasy_gameweeks as previous_gameweeks
      on previous_gameweeks.id = previous_snapshots.fantasy_gameweek_id
    where previous_snapshots.fantasy_team_id = fantasy_teams.id
      and previous_gameweeks.lock_at < fantasy_gameweeks.lock_at
    order by previous_gameweeks.lock_at desc
    limit 1
  ) as previous_snapshot on true
  left join lateral (
    select
      case
        when previous_snapshot.fantasy_gameweek_id is null then null
        else least(previous_snapshot.free_transfers_after_lock + 1, 4)
      end as free_transfers_at_lock
  ) as transfer_bank on true
  left join lateral (
    select count(*)::integer as transfer_count
    from public.fantasy_team_players as current_squad
    where current_squad.fantasy_team_id = fantasy_teams.id
      and previous_snapshot.fantasy_gameweek_id is not null
      and not exists (
        select 1
        from public.fantasy_team_gameweek_players as previous_players
        where previous_players.fantasy_team_id = fantasy_teams.id
          and previous_players.fantasy_gameweek_id = previous_snapshot.fantasy_gameweek_id
          and previous_players.player_id = current_squad.player_id
      )
  ) as transfer_usage on true
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
    (
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
    ) + snapshots.transfer_penalty_points)::integer as points,
    now(),
    now()
  from public.fantasy_team_gameweek_snapshots as snapshots
  left join public.fantasy_team_gameweek_players as snapshot_players
    on snapshot_players.fantasy_team_id = snapshots.fantasy_team_id
    and snapshot_players.fantasy_gameweek_id = snapshots.fantasy_gameweek_id
  where snapshots.fantasy_gameweek_id = target_gameweek_id
  group by
    snapshots.fantasy_team_id,
    snapshots.fantasy_gameweek_id,
    snapshots.transfer_penalty_points
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
  active_chip text,
  transfer_count_at_lock integer,
  transfer_penalty_points integer
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
    fantasy_team_gameweek_snapshots.active_chip,
    coalesce(fantasy_team_gameweek_snapshots.transfer_count_at_lock, 0) as transfer_count_at_lock,
    coalesce(fantasy_team_gameweek_snapshots.transfer_penalty_points, 0) as transfer_penalty_points
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
where jobname = 'snapshot-locked-squads';

select cron.schedule(
  'snapshot-locked-squads',
  '*/5 * * * *',
  $cron$select public.snapshot_locked_squads();$cron$
);

select cron.unschedule(jobid)
from cron.job
where jobname = 'mark-used-chips';

select cron.schedule(
  'mark-used-chips',
  '*/15 * * * *',
  $cron$select public.mark_used_chips();$cron$
);

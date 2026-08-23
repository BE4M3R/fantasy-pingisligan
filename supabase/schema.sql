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

create unique index if not exists fantasy_teams_completed_name_unique
on public.fantasy_teams (lower(btrim(name)))
where onboarding_completed;

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
  data_refreshed_at timestamptz,
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

create or replace function public.transfers_are_locked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.fantasy_gameweeks
    where now() >= fantasy_gameweeks.lock_at
      and fantasy_gameweeks.data_refreshed_at is null
  );
$$;

revoke all on function public.transfers_are_locked() from public;
grant execute on function public.transfers_are_locked() to anon, authenticated;

create or replace function public.enforce_transfer_refresh_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_team_id uuid;
begin
  affected_team_id := case
    when tg_op = 'DELETE' then old.fantasy_team_id
    else new.fantasy_team_id
  end;

  if auth.uid() is not null
    and public.transfers_are_locked()
    and exists (
      select 1
      from public.fantasy_teams
      where fantasy_teams.id = affected_team_id
        and fantasy_teams.user_id = auth.uid()
    ) then
    raise exception 'Transfers remain closed while gameweek data and player prices are updated.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_transfer_refresh_lock() from public;

drop trigger if exists enforce_transfer_refresh_lock
on public.fantasy_team_players;

create trigger enforce_transfer_refresh_lock
before insert or update or delete
on public.fantasy_team_players
for each row
execute function public.enforce_transfer_refresh_lock();

drop trigger if exists enforce_transfer_refresh_lock
on public.fantasy_team_chip_selections;

create trigger enforce_transfer_refresh_lock
before insert or update or delete
on public.fantasy_team_chip_selections
for each row
execute function public.enforce_transfer_refresh_lock();

-- Preserve unspent cash when a player in the pending unlocked gameweek
-- snapshot is repriced. Using the immutable squad avoids a race with transfers
-- made after midnight but before the price import runs.
create or replace function public.preserve_team_cash_on_player_reprice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_unlocked_gameweek_id uuid;
begin
  select fantasy_gameweeks.id
  into latest_unlocked_gameweek_id
  from public.fantasy_gameweeks
  where now() > fantasy_gameweeks.unlock_at
    and fantasy_gameweeks.data_refreshed_at is null
  order by fantasy_gameweeks.unlock_at, fantasy_gameweeks.id
  limit 1;

  if latest_unlocked_gameweek_id is null then
    return new;
  end if;

  update public.fantasy_teams
  set
    budget = budget + (new.price - old.price),
    updated_at = now()
  where onboarding_completed
    and exists (
      select 1
      from public.fantasy_team_gameweek_players
      where fantasy_team_gameweek_players.fantasy_team_id = fantasy_teams.id
        and fantasy_team_gameweek_players.fantasy_gameweek_id =
          latest_unlocked_gameweek_id
        and fantasy_team_gameweek_players.player_id = new.id
    );

  return new;
end;
$$;

revoke all on function public.preserve_team_cash_on_player_reprice()
from public;

drop trigger if exists preserve_team_cash_on_player_reprice
on public.players;

create trigger preserve_team_cash_on_player_reprice
after update of price
on public.players
for each row
when (old.price is distinct from new.price)
execute function public.preserve_team_cash_on_player_reprice();

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

create index if not exists league_members_fantasy_team_idx
on public.league_members (fantasy_team_id, league_id);

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
  home_team_stupa_participant_id integer,
  away_team_stupa_participant_id integer,
  winning_team_stupa_participant_id integer,
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
  not public.transfers_are_locked()
  and
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_players.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
)
with check (
  not public.transfers_are_locked()
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
    coalesce(sum(gameweek_points.points), 0)::bigint as total_points
  from public.fantasy_teams
  left join public.fantasy_team_gameweek_points as gameweek_points
    on gameweek_points.fantasy_team_id = fantasy_teams.id
  where fantasy_teams.onboarding_completed
  group by fantasy_teams.user_id, fantasy_teams.name
  order by total_points desc, lower(fantasy_teams.name), fantasy_teams.user_id;
$$;

grant execute on function public.get_global_leaderboard() to authenticated;

create or replace function public.get_leaderboard_team_gameweek_points(
  p_user_id uuid
)
returns table (
  gameweek_id uuid,
  gameweek_name text,
  round_order integer,
  points integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  return query
  select
    gameweeks.id as gameweek_id,
    gameweeks.name as gameweek_name,
    gameweeks.round_order,
    coalesce(team_points.points, 0) as points
  from public.fantasy_teams
  cross join public.fantasy_gameweeks as gameweeks
  left join public.fantasy_team_gameweek_points as team_points
    on team_points.fantasy_team_id = fantasy_teams.id
    and team_points.fantasy_gameweek_id = gameweeks.id
  where fantasy_teams.user_id = p_user_id
    and fantasy_teams.onboarding_completed
    and exists (
      select 1
      from public.fantasy_team_gameweek_points as scored_gameweek
      where scored_gameweek.fantasy_gameweek_id = gameweeks.id
    )
  order by
    gameweeks.round_order nulls last,
    gameweeks.first_match_starts_at,
    gameweeks.id;
end;
$$;

revoke all on function public.get_leaderboard_team_gameweek_points(uuid) from public;
grant execute on function public.get_leaderboard_team_gameweek_points(uuid) to authenticated;

create or replace function public.create_private_league(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_team_id uuid;
  clean_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  new_league_id uuid;
begin
  if current_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  if clean_name = '' then
    raise exception 'Leaderboard name cannot be empty.';
  end if;

  if char_length(clean_name) > 50 then
    raise exception 'Leaderboard name can be at most 50 characters.';
  end if;

  select fantasy_teams.id
  into current_team_id
  from public.fantasy_teams
  where fantasy_teams.user_id = current_user_id
    and fantasy_teams.onboarding_completed;

  if current_team_id is null then
    raise exception 'Name your fantasy team before creating a private leaderboard.';
  end if;

  insert into public.leagues (owner_id, name)
  values (current_user_id, clean_name)
  returning id into new_league_id;

  insert into public.league_members (league_id, fantasy_team_id)
  values (new_league_id, current_team_id);

  return new_league_id;
end;
$$;

create or replace function public.join_private_league(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_team_id uuid;
  matched_league_id uuid;
  clean_invite_code text := upper(btrim(coalesce(p_invite_code, '')));
begin
  if current_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select fantasy_teams.id
  into current_team_id
  from public.fantasy_teams
  where fantasy_teams.user_id = current_user_id
    and fantasy_teams.onboarding_completed;

  if current_team_id is null then
    raise exception 'Name your fantasy team before joining a private leaderboard.';
  end if;

  select leagues.id
  into matched_league_id
  from public.leagues
  where upper(leagues.invite_code) = clean_invite_code;

  if matched_league_id is null then
    raise exception 'That invitation code is not valid.';
  end if;

  insert into public.league_members (league_id, fantasy_team_id)
  values (matched_league_id, current_team_id)
  on conflict (league_id, fantasy_team_id) do nothing;

  return matched_league_id;
end;
$$;

create or replace function public.get_my_private_leagues()
returns table (
  league_id uuid,
  league_name text,
  invite_code text,
  is_owner boolean,
  member_count bigint,
  current_rank bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    leagues.id as league_id,
    leagues.name as league_name,
    case when leagues.owner_id = auth.uid() then leagues.invite_code end as invite_code,
    leagues.owner_id = auth.uid() as is_owner,
    (
      select count(*)
      from public.league_members as counted_members
      where counted_members.league_id = leagues.id
    )::bigint as member_count,
    (
      select ranked_members.current_rank
      from (
        select
          ranked_league_members.fantasy_team_id,
          row_number() over (
            order by
              coalesce(sum(gameweek_points.points), 0) desc,
              lower(ranked_teams.name),
              ranked_teams.user_id
          ) as current_rank
        from public.league_members as ranked_league_members
        join public.fantasy_teams as ranked_teams
          on ranked_teams.id = ranked_league_members.fantasy_team_id
        left join public.fantasy_team_gameweek_points as gameweek_points
          on gameweek_points.fantasy_team_id = ranked_teams.id
        where ranked_league_members.league_id = leagues.id
          and ranked_teams.onboarding_completed
        group by
          ranked_league_members.fantasy_team_id,
          ranked_teams.name,
          ranked_teams.user_id
      ) as ranked_members
      where ranked_members.fantasy_team_id = fantasy_teams.id
    )::bigint as current_rank
  from public.leagues
  join public.league_members
    on league_members.league_id = leagues.id
  join public.fantasy_teams
    on fantasy_teams.id = league_members.fantasy_team_id
  where fantasy_teams.user_id = auth.uid()
  order by lower(leagues.name), leagues.id;
$$;

create or replace function public.get_private_league_leaderboard(p_league_id uuid)
returns table (
  user_id uuid,
  team_name text,
  total_points bigint
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if not exists (
    select 1
    from public.league_members
    join public.fantasy_teams
      on fantasy_teams.id = league_members.fantasy_team_id
    where league_members.league_id = p_league_id
      and fantasy_teams.user_id = auth.uid()
  ) then
    raise exception 'You do not have access to that private leaderboard.';
  end if;

  return query
  select
    fantasy_teams.user_id,
    fantasy_teams.name as team_name,
    coalesce(sum(gameweek_points.points), 0)::bigint as total_points
  from public.league_members
  join public.fantasy_teams
    on fantasy_teams.id = league_members.fantasy_team_id
  left join public.fantasy_team_gameweek_points as gameweek_points
    on gameweek_points.fantasy_team_id = fantasy_teams.id
  where league_members.league_id = p_league_id
    and fantasy_teams.onboarding_completed
  group by fantasy_teams.user_id, fantasy_teams.name
  order by
    coalesce(sum(gameweek_points.points), 0)::bigint desc,
    lower(fantasy_teams.name),
    fantasy_teams.user_id;
end;
$$;

revoke all on function public.create_private_league(text) from public;
revoke all on function public.join_private_league(text) from public;
revoke all on function public.get_my_private_leagues() from public;
revoke all on function public.get_private_league_leaderboard(uuid) from public;

grant execute on function public.create_private_league(text) to authenticated;
grant execute on function public.join_private_league(text) to authenticated;
grant execute on function public.get_my_private_leagues() to authenticated;
grant execute on function public.get_private_league_leaderboard(uuid) to authenticated;

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

  if public.transfers_are_locked() then
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
  is_refreshing boolean,
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
        and data_refreshed_at is null
    ) as is_locked,
    coalesce(
      now() > locked_gameweek.unlock_at
        and locked_gameweek.data_refreshed_at is null,
      false
    ) as is_refreshing,
    locked_gameweek.id as gameweek_id,
    locked_gameweek.name as gameweek_name,
    locked_gameweek.lock_at,
    locked_gameweek.unlock_at
  from (
    select *
    from public.fantasy_gameweeks
    where now() >= lock_at
      and data_refreshed_at is null
    order by lock_at desc
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

create or replace function public.calculate_player_match_stats(target_gameweek_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_stat_count integer;
begin
  delete from public.player_match_stats
  using public.matches
  where matches.id = player_match_stats.match_id
    and matches.fantasy_gameweek_id = target_gameweek_id;

  with side_sizes as (
    select
      results.stupa_submatch_id,
      results.team_stupa_participant_id,
      count(*)::integer as player_count
    from public.player_submatch_results as results
    group by results.stupa_submatch_id, results.team_stupa_participant_id
  ),
  submatch_context as (
    select
      submatches.stupa_submatch_id,
      submatches.match_id,
      bool_or(side_sizes.player_count > 1) as is_doubles,
      bool_or(
        results.walkover
        or nullif(results.raw_payload #>> '{side,walkover_reason}', '') is not null
      ) as is_walkover
    from public.stupa_submatches as submatches
    join public.matches
      on matches.id = submatches.match_id
      and matches.fantasy_gameweek_id = target_gameweek_id
    join public.player_submatch_results as results
      on results.stupa_submatch_id = submatches.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where upper(submatches.status) = 'SCORED'
    group by submatches.stupa_submatch_id, submatches.match_id
  ),
  result_points as (
    select
      context.match_id,
      results.player_id,
      context.is_doubles,
      results.won,
      case
        when context.is_walkover and results.won then 3
        when context.is_walkover then 0
        else results.sets_won
      end as won_sets,
      case when context.is_walkover then 0 else results.sets_lost end as lost_sets,
      case
        when context.is_doubles then
          (case when results.won then 2 else 0 end)
          + ceil(
              (
                case
                  when context.is_walkover and results.won then 3
                  when context.is_walkover then 0
                  else results.sets_won
                end
              )::numeric / side_sizes.player_count
            )::integer
        when context.is_walkover then case when results.won then 7 else 0 end
        else
          (case when results.won then 4 else 0 end)
          + results.sets_won
      end as points
    from submatch_context as context
    join public.player_submatch_results as results
      on results.stupa_submatch_id = context.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where results.player_id is not null
  ),
  result_totals as (
    select
      match_id,
      player_id,
      count(*) filter (where won)::integer as won_matches,
      count(*) filter (where not won)::integer as lost_matches,
      sum(won_sets)::integer as won_sets,
      sum(lost_sets)::integer as lost_sets,
      sum(points)::integer as points
    from result_points
    group by match_id, player_id
  ),
  singles_bonus as (
    select
      result_points.player_id,
      min(result_points.match_id::text)::uuid as bonus_match_id
    from result_points
    where not result_points.is_doubles
    group by result_points.player_id
    having count(*) >= 2 and bool_and(result_points.won)
  ),
  winning_clubs as (
    select
      matches.id as match_id,
      case
        when lower(matches.status) = 'scored'
          and matches.winning_team_stupa_participant_id =
          matches.home_team_stupa_participant_id then matches.home_club_id
        when lower(matches.status) = 'scored'
          and matches.winning_team_stupa_participant_id =
          matches.away_team_stupa_participant_id then matches.away_club_id
      end as club_id
    from public.matches
    where matches.fantasy_gameweek_id = target_gameweek_id
  ),
  match_players as (
    select result_totals.match_id, result_totals.player_id
    from result_totals
    union
    select winning_clubs.match_id, players.id
    from winning_clubs
    join public.players on players.club_id = winning_clubs.club_id
    where winning_clubs.club_id is not null
  )
  insert into public.player_match_stats (
    match_id,
    player_id,
    won_matches,
    lost_matches,
    won_sets,
    lost_sets,
    fantasy_points
  )
  select
    match_players.match_id,
    match_players.player_id,
    coalesce(result_totals.won_matches, 0),
    coalesce(result_totals.lost_matches, 0),
    coalesce(result_totals.won_sets, 0),
    coalesce(result_totals.lost_sets, 0),
    coalesce(result_totals.points, 0)
      + case when winning_clubs.club_id = players.club_id then 3 else 0 end
      + case when singles_bonus.bonus_match_id = match_players.match_id then 2 else 0 end
  from match_players
  join public.players on players.id = match_players.player_id
  left join result_totals
    on result_totals.match_id = match_players.match_id
    and result_totals.player_id = match_players.player_id
  left join winning_clubs on winning_clubs.match_id = match_players.match_id
  left join singles_bonus on singles_bonus.player_id = match_players.player_id;

  get diagnostics inserted_stat_count = row_count;
  return inserted_stat_count;
end;
$$;

revoke all on function public.calculate_player_match_stats(uuid) from public;
grant execute on function public.calculate_player_match_stats(uuid) to service_role;

create or replace function public.calculate_fantasy_gameweek_points(target_gameweek_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_team_count integer;
begin
  perform public.calculate_player_match_stats(target_gameweek_id);

  update public.fantasy_team_gameweek_players
  set fantasy_points = 0
  where fantasy_gameweek_id = target_gameweek_id;

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
    snapshots.active_chip,
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

create or replace function public.get_my_played_gameweek_progress()
returns table (
  gameweek_id uuid,
  gameweek_name text,
  round_order integer,
  first_match_starts_at timestamptz,
  last_match_ends_at timestamptz,
  points integer,
  average_points numeric,
  max_points integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  return query
  select
    gameweeks.id as gameweek_id,
    gameweeks.name as gameweek_name,
    gameweeks.round_order,
    gameweeks.first_match_starts_at,
    gameweeks.last_match_ends_at,
    coalesce(my_points.points, 0) as points,
    round(avg(all_points.points)::numeric, 1) as average_points,
    max(all_points.points) as max_points
  from public.fantasy_gameweeks as gameweeks
  join public.fantasy_team_gameweek_points as all_points
    on all_points.fantasy_gameweek_id = gameweeks.id
  join public.fantasy_teams as my_team
    on my_team.user_id = auth.uid()
  left join public.fantasy_team_gameweek_points as my_points
    on my_points.fantasy_gameweek_id = gameweeks.id
    and my_points.fantasy_team_id = my_team.id
  where now() > gameweeks.unlock_at
  group by
    gameweeks.id,
    gameweeks.name,
    gameweeks.round_order,
    gameweeks.first_match_starts_at,
    gameweeks.last_match_ends_at,
    my_points.points
  order by
    gameweeks.round_order nulls last,
    gameweeks.first_match_starts_at,
    gameweeks.id;
end;
$$;

revoke all on function public.get_my_played_gameweek_progress() from public;
grant execute on function public.get_my_played_gameweek_progress() to authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'snapshot-locked-squads';

select cron.schedule(
  'snapshot-locked-squads',
  '*/5 * * * *',
  $cron$select public.snapshot_locked_squads();$cron$
);

create or replace function public.get_my_latest_squad_result()
returns table (
  gameweek_id uuid,
  gameweek_name text,
  round_order integer,
  active_chip text,
  player_id uuid,
  first_name text,
  last_name text,
  club_id uuid,
  club_name text,
  price numeric,
  "position" text,
  is_captain boolean,
  fantasy_points integer,
  singles_wins integer,
  singles_losses integer,
  doubles_wins integer,
  doubles_losses integer,
  sets_won integer,
  sets_lost integer,
  match_win_points integer,
  set_points integer,
  fixture_win_points integer,
  sweep_bonus_points integer,
  captain_bonus_points integer,
  counts_for_team boolean,
  team_points_contribution integer
)
language sql
security definer
set search_path = ''
stable
as $$
  with latest_snapshot as (
    select
      snapshots.fantasy_team_id,
      snapshots.fantasy_gameweek_id,
      snapshots.active_chip,
      gameweeks.name as gameweek_name,
      gameweeks.round_order,
      gameweeks.lock_at
    from public.fantasy_team_gameweek_snapshots as snapshots
    join public.fantasy_teams as teams
      on teams.id = snapshots.fantasy_team_id
      and teams.user_id = auth.uid()
    join public.fantasy_gameweeks as gameweeks
      on gameweeks.id = snapshots.fantasy_gameweek_id
    order by
      gameweeks.round_order desc nulls last,
      gameweeks.lock_at desc,
      gameweeks.id
    limit 1
  ),
  side_sizes as (
    select
      results.stupa_submatch_id,
      results.team_stupa_participant_id,
      count(*)::integer as player_count
    from public.player_submatch_results as results
    join public.stupa_submatches as submatches
      on submatches.stupa_submatch_id = results.stupa_submatch_id
    join public.matches as matches
      on matches.id = submatches.match_id
    join latest_snapshot
      on latest_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
    group by results.stupa_submatch_id, results.team_stupa_participant_id
  ),
  submatch_context as (
    select
      submatches.stupa_submatch_id,
      bool_or(side_sizes.player_count > 1) as is_doubles,
      bool_or(
        results.walkover
        or nullif(results.raw_payload #>> '{side,walkover_reason}', '') is not null
      ) as is_walkover
    from public.stupa_submatches as submatches
    join public.matches as matches
      on matches.id = submatches.match_id
    join latest_snapshot
      on latest_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
    join public.player_submatch_results as results
      on results.stupa_submatch_id = submatches.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where upper(submatches.status) = 'SCORED'
    group by submatches.stupa_submatch_id
  ),
  result_components as (
    select
      results.player_id,
      context.is_doubles,
      results.won,
      case
        when context.is_walkover and results.won then 3
        when context.is_walkover then 0
        else results.sets_won
      end as sets_won,
      case when context.is_walkover then 0 else results.sets_lost end as sets_lost,
      case
        when results.won and context.is_doubles then 2
        when results.won then 4
        else 0
      end as match_win_points,
      case
        when context.is_doubles then
          ceil(
            (
              case
                when context.is_walkover and results.won then 3
                when context.is_walkover then 0
                else results.sets_won
              end
            )::numeric / side_sizes.player_count
          )::integer
        when context.is_walkover and results.won then 3
        when context.is_walkover then 0
        else results.sets_won
      end as set_points
    from submatch_context as context
    join public.player_submatch_results as results
      on results.stupa_submatch_id = context.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where results.player_id is not null
  ),
  result_totals as (
    select
      player_id,
      count(*) filter (where not is_doubles and won)::integer as singles_wins,
      count(*) filter (where not is_doubles and not won)::integer as singles_losses,
      count(*) filter (where is_doubles and won)::integer as doubles_wins,
      count(*) filter (where is_doubles and not won)::integer as doubles_losses,
      sum(sets_won)::integer as sets_won,
      sum(sets_lost)::integer as sets_lost,
      sum(match_win_points)::integer as match_win_points,
      sum(set_points)::integer as set_points
    from result_components
    group by player_id
  ),
  sweep_bonuses as (
    select player_id, 2::integer as sweep_bonus_points
    from result_components
    where not is_doubles
    group by player_id
    having count(*) >= 2 and bool_and(won)
  ),
  fixture_bonuses as (
    select
      snapshot_players.player_id,
      (count(*) * 3)::integer as fixture_win_points
    from latest_snapshot
    join public.fantasy_team_gameweek_players as snapshot_players
      on snapshot_players.fantasy_team_id = latest_snapshot.fantasy_team_id
      and snapshot_players.fantasy_gameweek_id = latest_snapshot.fantasy_gameweek_id
    join public.players
      on players.id = snapshot_players.player_id
    join public.matches
      on matches.fantasy_gameweek_id = latest_snapshot.fantasy_gameweek_id
      and lower(matches.status) = 'scored'
      and (
        (
          matches.winning_team_stupa_participant_id = matches.home_team_stupa_participant_id
          and matches.home_club_id = players.club_id
        )
        or (
          matches.winning_team_stupa_participant_id = matches.away_team_stupa_participant_id
          and matches.away_club_id = players.club_id
        )
      )
    group by snapshot_players.player_id
  ),
  player_scores as (
    select
      latest_snapshot.fantasy_team_id,
      latest_snapshot.fantasy_gameweek_id,
      latest_snapshot.active_chip,
      latest_snapshot.gameweek_name,
      latest_snapshot.round_order,
      snapshot_players.player_id,
      snapshot_players.player_first_name_at_lock,
      snapshot_players.player_last_name_at_lock,
      snapshot_players.club_id_at_lock,
      snapshot_players.club_name_at_lock,
      snapshot_players.price_at_lock,
      snapshot_players.position,
      snapshot_players.is_captain,
      coalesce(snapshot_players.fantasy_points, 0)::integer as fantasy_points,
      coalesce(result_totals.singles_wins, 0)::integer as singles_wins,
      coalesce(result_totals.singles_losses, 0)::integer as singles_losses,
      coalesce(result_totals.doubles_wins, 0)::integer as doubles_wins,
      coalesce(result_totals.doubles_losses, 0)::integer as doubles_losses,
      coalesce(result_totals.sets_won, 0)::integer as sets_won,
      coalesce(result_totals.sets_lost, 0)::integer as sets_lost,
      coalesce(result_totals.match_win_points, 0)::integer as match_win_points,
      coalesce(result_totals.set_points, 0)::integer as set_points,
      coalesce(fixture_bonuses.fixture_win_points, 0)::integer as fixture_win_points,
      coalesce(sweep_bonuses.sweep_bonus_points, 0)::integer as sweep_bonus_points
    from latest_snapshot
    join public.fantasy_team_gameweek_players as snapshot_players
      on snapshot_players.fantasy_team_id = latest_snapshot.fantasy_team_id
      and snapshot_players.fantasy_gameweek_id = latest_snapshot.fantasy_gameweek_id
    left join result_totals on result_totals.player_id = snapshot_players.player_id
    left join fixture_bonuses on fixture_bonuses.player_id = snapshot_players.player_id
    left join sweep_bonuses on sweep_bonuses.player_id = snapshot_players.player_id
  )
  select
    player_scores.fantasy_gameweek_id,
    player_scores.gameweek_name,
    player_scores.round_order,
    player_scores.active_chip,
    player_scores.player_id,
    player_scores.player_first_name_at_lock,
    player_scores.player_last_name_at_lock,
    player_scores.club_id_at_lock,
    player_scores.club_name_at_lock,
    player_scores.price_at_lock,
    player_scores.position,
    player_scores.is_captain,
    player_scores.fantasy_points,
    player_scores.singles_wins,
    player_scores.singles_losses,
    player_scores.doubles_wins,
    player_scores.doubles_losses,
    player_scores.sets_won,
    player_scores.sets_lost,
    player_scores.match_win_points,
    player_scores.set_points,
    player_scores.fixture_win_points,
    player_scores.sweep_bonus_points,
    case
      when player_scores.is_captain
        and player_scores.position = 'starter'
        and player_scores.active_chip = 'triple_captain'
        then player_scores.fantasy_points * 2
      when player_scores.is_captain and player_scores.position = 'starter'
        then player_scores.fantasy_points
      else 0
    end::integer as captain_bonus_points,
    (
      player_scores.position = 'starter'
      or player_scores.active_chip = 'bench_boost'
    ) as counts_for_team,
    case
      when player_scores.position = 'bench'
        and player_scores.active_chip is distinct from 'bench_boost' then 0
      when player_scores.is_captain
        and player_scores.position = 'starter'
        and player_scores.active_chip = 'triple_captain'
        then player_scores.fantasy_points * 3
      when player_scores.is_captain and player_scores.position = 'starter'
        then player_scores.fantasy_points * 2
      else player_scores.fantasy_points
    end::integer as team_points_contribution
  from player_scores
  order by
    case when player_scores.position = 'starter' then 0 else 1 end,
    player_scores.player_last_name_at_lock,
    player_scores.player_first_name_at_lock,
    player_scores.player_id;
$$;

revoke all on function public.get_my_latest_squad_result() from public;
grant execute on function public.get_my_latest_squad_result() to authenticated;

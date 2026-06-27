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
  home_club_id uuid references public.clubs(id) on delete set null,
  away_club_id uuid references public.clubs(id) on delete set null,
  starts_at timestamptz,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);

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

alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.players enable row level security;
alter table public.fantasy_teams enable row level security;
alter table public.fantasy_team_players enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.matches enable row level security;
alter table public.player_match_stats enable row level security;

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
  exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_players.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
)
with check (
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

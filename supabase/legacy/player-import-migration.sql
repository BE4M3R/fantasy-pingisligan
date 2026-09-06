alter table public.players
  add column if not exists profixio_id text,
  add column if not exists birth_year integer,
  add column if not exists ranking_position integer,
  add column if not exists ranking_points integer,
  add column if not exists source_updated_at timestamptz;

create unique index if not exists players_profixio_id_key
on public.players (profixio_id);

alter table public.players
  alter column price type numeric(12, 0)
    using (
      case
        when price < 100000 then price * 1000000
        else price
      end
    )::numeric(12, 0),
  alter column price set default 5000000;

alter table public.fantasy_teams
  add column if not exists onboarding_completed boolean not null default false;

alter table public.fantasy_teams
  alter column budget type numeric(12, 0)
    using (
      case
        when budget < 100000 then budget * 1000000
        else budget
      end
    )::numeric(12, 0),
  alter column budget set default 100000000;

update public.fantasy_team_players
set position = 'starter'
where position not in ('starter', 'bench');

alter table public.fantasy_team_players
  add column if not exists is_captain boolean not null default false;

with first_players as (
  select distinct on (fantasy_team_id)
    fantasy_team_id,
    player_id
  from public.fantasy_team_players
  order by fantasy_team_id, created_at, player_id
)
update public.fantasy_team_players ftp
set is_captain = true
from first_players
where ftp.fantasy_team_id = first_players.fantasy_team_id
  and ftp.player_id = first_players.player_id
  and not exists (
    select 1
    from public.fantasy_team_players existing_captain
    where existing_captain.fantasy_team_id = first_players.fantasy_team_id
      and existing_captain.is_captain
  );

alter table public.fantasy_team_players
  drop constraint if exists fantasy_team_players_position_check,
  add constraint fantasy_team_players_position_check
    check (position in ('starter', 'bench'));

create unique index if not exists fantasy_team_players_one_captain
on public.fantasy_team_players (fantasy_team_id)
where is_captain;

create table if not exists public.fantasy_gameweeks (
  id uuid primary key default gen_random_uuid(),
  stupa_event_id integer not null,
  stupa_event_category_id integer not null,
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

alter table public.matches
  add column if not exists stupa_match_id integer,
  add column if not exists fantasy_gameweek_id uuid references public.fantasy_gameweeks(id) on delete set null,
  add column if not exists stupa_event_match_id integer,
  add column if not exists stupa_event_id integer,
  add column if not exists stupa_event_category_id integer,
  add column if not exists stupa_round_id integer,
  add column if not exists stupa_group_id integer,
  add column if not exists home_team_name text,
  add column if not exists away_team_name text,
  add column if not exists ends_at timestamptz,
  add column if not exists source_updated_at timestamptz;

drop index if exists matches_stupa_match_id_key;
create unique index matches_stupa_match_id_key
on public.matches (stupa_match_id);

alter table public.fantasy_gameweeks enable row level security;
alter table public.fantasy_team_gameweek_points enable row level security;

drop policy if exists "Fantasy gameweeks are public" on public.fantasy_gameweeks;
create policy "Fantasy gameweeks are public"
on public.fantasy_gameweeks for select
to anon, authenticated
using (true);

drop policy if exists "Users can read their gameweek points" on public.fantasy_team_gameweek_points;
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

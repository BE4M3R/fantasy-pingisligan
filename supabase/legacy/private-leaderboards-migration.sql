begin;

-- Existing projects already have these tables from the base schema. Keeping
-- the definitions here makes this migration safe for older installations too.
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

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;

-- Owners must be members as well so all league reads have one membership path.
insert into public.league_members (league_id, fantasy_team_id)
select leagues.id, fantasy_teams.id
from public.leagues
join public.fantasy_teams on fantasy_teams.user_id = leagues.owner_id
on conflict (league_id, fantasy_team_id) do nothing;

-- Creation and joining only go through the functions below, where names,
-- invite codes and the current user's fantasy team are verified.
drop policy if exists "Users can create leagues"
on public.leagues;

drop policy if exists "Users can join leagues with their team"
on public.league_members;

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
  member_count bigint
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
    )::bigint as member_count
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
    coalesce(sum(fantasy_team_gameweek_points.points), 0)::bigint as total_points
  from public.league_members
  join public.fantasy_teams
    on fantasy_teams.id = league_members.fantasy_team_id
  left join public.fantasy_team_gameweek_points
    on fantasy_team_gameweek_points.fantasy_team_id = fantasy_teams.id
  where league_members.league_id = p_league_id
    and fantasy_teams.onboarding_completed
  group by fantasy_teams.user_id, fantasy_teams.name
  order by
    coalesce(sum(fantasy_team_gameweek_points.points), 0)::bigint desc,
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

commit;

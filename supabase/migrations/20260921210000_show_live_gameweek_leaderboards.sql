-- Expose a gameweek in leaderboards as soon as its first fixture starts.
-- Scores remain live until the post-gameweek refresh completes successfully.
create or replace function public.gameweek_results_are_visible(
  first_match_starts_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select now() >= first_match_starts_at;
$$;

revoke all on function public.gameweek_results_are_visible(timestamptz)
from public;

create or replace function public.get_global_leaderboard()
returns table (
  user_id uuid,
  team_name text,
  total_points bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    fantasy_teams.user_id,
    fantasy_teams.name as team_name,
    coalesce(
      sum(gameweek_points.points) filter (
        where scored_gameweeks.id is not null
      ),
      0
    )::bigint as total_points
  from public.fantasy_teams
  left join public.fantasy_team_gameweek_points as gameweek_points
    on gameweek_points.fantasy_team_id = fantasy_teams.id
  left join public.fantasy_gameweeks as scored_gameweeks
    on scored_gameweeks.id = gameweek_points.fantasy_gameweek_id
    and public.gameweek_results_are_visible(
      scored_gameweeks.first_match_starts_at
    )
  where fantasy_teams.onboarding_completed
  group by fantasy_teams.user_id, fantasy_teams.name
  order by total_points desc, lower(fantasy_teams.name), fantasy_teams.user_id;
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
              coalesce(
                sum(gameweek_points.points) filter (
                  where scored_gameweeks.id is not null
                ),
                0
              ) desc,
              lower(ranked_teams.name),
              ranked_teams.user_id
          ) as current_rank
        from public.league_members as ranked_league_members
        join public.fantasy_teams as ranked_teams
          on ranked_teams.id = ranked_league_members.fantasy_team_id
        left join public.fantasy_team_gameweek_points as gameweek_points
          on gameweek_points.fantasy_team_id = ranked_teams.id
        left join public.fantasy_gameweeks as scored_gameweeks
          on scored_gameweeks.id = gameweek_points.fantasy_gameweek_id
          and public.gameweek_results_are_visible(
            scored_gameweeks.first_match_starts_at
          )
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

create or replace function public.get_private_league_leaderboard(
  p_league_id uuid
)
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
    coalesce(
      sum(gameweek_points.points) filter (
        where scored_gameweeks.id is not null
      ),
      0
    )::bigint as total_points
  from public.league_members
  join public.fantasy_teams
    on fantasy_teams.id = league_members.fantasy_team_id
  left join public.fantasy_team_gameweek_points as gameweek_points
    on gameweek_points.fantasy_team_id = fantasy_teams.id
  left join public.fantasy_gameweeks as scored_gameweeks
    on scored_gameweeks.id = gameweek_points.fantasy_gameweek_id
    and public.gameweek_results_are_visible(
      scored_gameweeks.first_match_starts_at
    )
  where league_members.league_id = p_league_id
    and fantasy_teams.onboarding_completed
  group by fantasy_teams.user_id, fantasy_teams.name
  order by
    coalesce(
      sum(gameweek_points.points) filter (
        where scored_gameweeks.id is not null
      ),
      0
    )::bigint desc,
    lower(fantasy_teams.name),
    fantasy_teams.user_id;
end;
$$;

-- The return shape gains is_final, so PostgreSQL requires the old function to
-- be dropped before it can be recreated.
drop function if exists public.get_leaderboard_team_gameweek_points(uuid);

create function public.get_leaderboard_team_gameweek_points(
  p_user_id uuid
)
returns table (
  gameweek_id uuid,
  gameweek_name text,
  round_order integer,
  points integer,
  is_final boolean
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
    coalesce(team_points.points, 0) as points,
    gameweeks.data_refreshed_at is not null as is_final
  from public.fantasy_teams
  cross join public.fantasy_gameweeks as gameweeks
  left join public.fantasy_team_gameweek_points as team_points
    on team_points.fantasy_team_id = fantasy_teams.id
    and team_points.fantasy_gameweek_id = gameweeks.id
  where fantasy_teams.user_id = p_user_id
    and fantasy_teams.onboarding_completed
    and public.gameweek_results_are_visible(
      gameweeks.first_match_starts_at
    )
  order by
    gameweeks.round_order nulls last,
    gameweeks.first_match_starts_at,
    gameweeks.id;
end;
$$;

revoke all on function public.get_leaderboard_team_gameweek_points(uuid)
from public;
grant execute on function public.get_leaderboard_team_gameweek_points(uuid)
to authenticated;


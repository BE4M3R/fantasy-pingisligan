-- Return the manager display name with each standings row, without extra
-- per-manager reads. Recreate the RPCs because their return shapes change.
-- Drop the search wrapper first; never cascade away unexpected dependencies.
drop function public.search_global_leaderboard(text, integer, integer);
drop function public.get_global_leaderboard();
drop function public.get_private_league_leaderboard(uuid);

create function public.get_global_leaderboard()
returns table (
  user_id uuid,
  team_name text,
  display_name text,
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
    profiles.display_name,
    coalesce(
      sum(gameweek_points.points) filter (
        where scored_gameweeks.id is not null
      ),
      0
    )::bigint as total_points
  from public.fantasy_teams
  left join public.profiles on profiles.id = fantasy_teams.user_id
  left join public.fantasy_team_gameweek_points as gameweek_points
    on gameweek_points.fantasy_team_id = fantasy_teams.id
  left join public.fantasy_gameweeks as scored_gameweeks
    on scored_gameweeks.id = gameweek_points.fantasy_gameweek_id
    and public.gameweek_results_are_visible(
      scored_gameweeks.first_match_starts_at
    )
  where fantasy_teams.onboarding_completed
  group by fantasy_teams.user_id, fantasy_teams.name, profiles.display_name
  order by total_points desc, lower(fantasy_teams.name), fantasy_teams.user_id;
$$;

create function public.get_private_league_leaderboard(
  p_league_id uuid
)
returns table (
  user_id uuid,
  team_name text,
  display_name text,
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
    profiles.display_name,
    coalesce(
      sum(gameweek_points.points) filter (
        where scored_gameweeks.id is not null
      ),
      0
    )::bigint as total_points
  from public.league_members
  join public.fantasy_teams
    on fantasy_teams.id = league_members.fantasy_team_id
  left join public.profiles on profiles.id = fantasy_teams.user_id
  left join public.fantasy_team_gameweek_points as gameweek_points
    on gameweek_points.fantasy_team_id = fantasy_teams.id
  left join public.fantasy_gameweeks as scored_gameweeks
    on scored_gameweeks.id = gameweek_points.fantasy_gameweek_id
    and public.gameweek_results_are_visible(
      scored_gameweeks.first_match_starts_at
    )
  where league_members.league_id = p_league_id
    and fantasy_teams.onboarding_completed
  group by fantasy_teams.user_id, fantasy_teams.name, profiles.display_name
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

-- Search the live standings in one database call while retaining global ranks.
-- Ranking must happen before filtering so a match keeps its normal position.
create function public.search_global_leaderboard(
  p_search text,
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (
  user_id uuid,
  team_name text,
  display_name text,
  total_points bigint,
  rank bigint,
  total_matches bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  with ranked as materialized (
    select
      teams.user_id,
      teams.team_name,
      teams.display_name,
      teams.total_points,
      row_number() over (
        order by teams.total_points desc, lower(teams.team_name), teams.user_id
      ) as rank
    from public.get_global_leaderboard() as teams
  ), matching as (
    select
      ranked.user_id,
      ranked.team_name,
      ranked.display_name,
      ranked.total_points,
      ranked.rank,
      count(*) over () as total_matches
    from ranked
    where strpos(lower(ranked.team_name), lower(btrim(p_search))) > 0
  )
  select
    matching.user_id,
    matching.team_name,
    matching.display_name,
    matching.total_points,
    matching.rank,
    matching.total_matches
  from matching
  order by matching.rank
  limit least(greatest(coalesce(p_limit, 50), 0), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.search_global_leaderboard(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.search_global_leaderboard(text, integer, integer)
to authenticated;

-- Preserve the existing public global standings and members-only private access.
grant execute on function public.get_global_leaderboard() to anon, authenticated;
revoke all on function public.get_private_league_leaderboard(uuid) from public, anon;
grant execute on function public.get_private_league_leaderboard(uuid) to authenticated;

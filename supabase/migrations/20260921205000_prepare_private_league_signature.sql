-- Production retained an older get_my_private_leagues() return shape while
-- staging already matched the baseline. Normalize the signature before the
-- live-leaderboard migration so PostgreSQL can replace the function there.
--
-- This recovery migration intentionally sorts before 20260921210000 and must
-- be deployed once with `supabase db push --include-all`. Its final definitions
-- match that migration, so applying it after 20260921210000 on staging is safe.
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

drop function if exists public.get_my_private_leagues();

create function public.get_my_private_leagues()
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

revoke all on function public.get_my_private_leagues() from public;
grant execute on function public.get_my_private_leagues() to authenticated;

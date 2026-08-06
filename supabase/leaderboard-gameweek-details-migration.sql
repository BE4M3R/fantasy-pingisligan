begin;

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

revoke all on function public.get_my_private_leagues() from public;
grant execute on function public.get_my_private_leagues() to authenticated;

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

commit;

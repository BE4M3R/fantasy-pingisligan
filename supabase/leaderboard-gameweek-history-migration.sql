begin;

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
    and now() > gameweeks.unlock_at
  order by
    gameweeks.round_order nulls last,
    gameweeks.first_match_starts_at,
    gameweeks.id;
end;
$$;

revoke all on function public.get_leaderboard_team_gameweek_points(uuid) from public;
grant execute on function public.get_leaderboard_team_gameweek_points(uuid) to authenticated;

commit;

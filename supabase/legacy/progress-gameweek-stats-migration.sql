begin;

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

commit;

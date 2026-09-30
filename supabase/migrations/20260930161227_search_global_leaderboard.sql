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
      teams.total_points,
      row_number() over (
        order by teams.total_points desc, lower(teams.team_name), teams.user_id
      ) as rank
    from public.get_global_leaderboard() as teams
  ), matching as (
    select
      ranked.user_id,
      ranked.team_name,
      ranked.total_points,
      ranked.rank,
      count(*) over () as total_matches
    from ranked
    where strpos(lower(ranked.team_name), lower(btrim(p_search))) > 0
  )
  select
    matching.user_id,
    matching.team_name,
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

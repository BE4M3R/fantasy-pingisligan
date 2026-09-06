begin;

alter table public.fantasy_teams
add column if not exists onboarding_completed boolean not null default false;

update public.fantasy_teams
set onboarding_completed = true
where btrim(name) <> ''
  and lower(btrim(name)) <> 'my team';

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

commit;

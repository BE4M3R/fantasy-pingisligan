-- Prevent authenticated users from changing squad composition while a round is active.
-- Service-role jobs continue to bypass RLS as normal.

drop policy if exists "Users can manage their squad"
on public.fantasy_team_players;

create policy "Users can manage their squad"
on public.fantasy_team_players for all
to authenticated
using (
  not exists (
    select 1
    from public.fantasy_gameweeks
    where now() >= lock_at
      and now() <= unlock_at
  )
  and exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_players.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
)
with check (
  not exists (
    select 1
    from public.fantasy_gameweeks
    where now() >= lock_at
      and now() <= unlock_at
  )
  and exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_players.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
);

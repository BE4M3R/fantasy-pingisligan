begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The operator selects the team directly in Table Editor. A foreign key gives
-- Studio its team picker and prevents misspelled/nonexistent team references.
alter table public.competition_publication
  add column competition_winner uuid references public.fantasy_teams(id) on delete set null,
  add constraint competition_winner_gameweek_only check (competition_winner is null or gameweek_id is not null);
create index competition_publication_winner_idx on public.competition_publication (competition_winner)
  where competition_winner is not null;
comment on column public.competition_publication.competition_winner is
  'Manually selected winning Fantasy team. Set on the correct Gameweek row in Table Editor to announce; clear to withdraw or change to replace. No automatic selection, draw or scoring validation.';

-- Preserve any already-published choices when upgrading the local prototype.
update public.competition_publication p set competition_winner = w.team_id
from private.gameweek_competition_winners w
where p.gameweek_id = w.gameweek_id and w.withdrawn_at is null and not w.needs_review;

drop trigger invalidate_competition_winner_score_insert on public.fantasy_team_gameweek_points;
drop trigger invalidate_competition_winner_score_update on public.fantasy_team_gameweek_points;
drop trigger invalidate_competition_winner_score_delete on public.fantasy_team_gameweek_points;
drop function private.invalidate_competition_winners();
drop function public.confirm_gameweek_competition_winner(uuid, uuid, boolean);
drop function public.withdraw_gameweek_competition_winner(uuid);
drop function public.get_public_competition_winners(uuid);
drop table private.gameweek_competition_winners;

-- Keep existing public switches readable without exposing private team IDs.
-- Operators/service_role retain the existing editorial write permissions.
revoke select on public.competition_publication from anon, authenticated;
grant select (id, enabled, gameweek_id, name) on public.competition_publication to anon, authenticated;

-- This is only a read projection of the operator's choice. Points are optional
-- stored Fantasy totals, never a condition for choosing or displaying a winner.
-- Existing global/round switches and future-Gameweek embargoes still apply.
create function public.get_public_competition_winners(p_gameweek_id uuid default null)
returns table (gameweek_id uuid, team_name text, points integer)
language sql stable security definer set search_path = '' as $$
  select p.gameweek_id, t.name, s.points
  from public.competition_publication p
  join public.fantasy_teams t on t.id = p.competition_winner
  join public.homepage_gameweek_states() g on g.gameweek_id = p.gameweek_id
  left join public.fantasy_team_gameweek_points s
    on s.fantasy_gameweek_id = p.gameweek_id and s.fantasy_team_id = p.competition_winner
  where public.competitions_enabled() and p.enabled and g.state <> 'upcoming'
    and (p_gameweek_id is null or p.gameweek_id = p_gameweek_id)
  order by g.lock_at, p.gameweek_id;
$$;
revoke all on function public.get_public_competition_winners(uuid) from public;
grant execute on function public.get_public_competition_winners(uuid) to anon, authenticated, service_role;

commit;

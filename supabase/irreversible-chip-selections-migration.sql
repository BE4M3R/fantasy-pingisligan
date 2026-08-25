-- A chip confirmation is final for its gameweek and season.

begin;

drop policy if exists "Users can update upcoming chip selections"
on public.fantasy_team_chip_selections;

drop policy if exists "Users can clear upcoming chip selections"
on public.fantasy_team_chip_selections;

drop index if exists public.fantasy_team_chip_selections_once_locked;

create unique index if not exists fantasy_team_chip_selections_once_confirmed
on public.fantasy_team_chip_selections (fantasy_team_id, chip);

commit;

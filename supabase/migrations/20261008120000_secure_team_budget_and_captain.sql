-- RLS still restricts edits to the team's owner. Column privileges restrict
-- what that owner may edit; budget changes remain available to service_role
-- and the existing SECURITY DEFINER repricing trigger.
revoke update on table public.fantasy_teams from public, anon, authenticated;
grant update (name, onboarding_completed, updated_at)
on table public.fantasy_teams to authenticated;

-- Allow both the database default and the application's explicit 100m insert.
-- Do not constrain stored budgets globally: trusted repricing may change them.
alter policy "Users can create their fantasy team"
on public.fantasy_teams
with check (auth.uid() = user_id and budget = 100000000);

-- Validate captaincy before invoking the existing atomic save implementation.
-- Keep snapshot and scoring functions intact, including automatic captain
-- substitution when a starting captain does not play.
create or replace function public.save_my_complete_fantasy_team(
  p_gameweek_id uuid,
  p_squad jsonb,
  p_chip text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  squad_count integer;
  starter_count integer;
  bench_count integer;
  captain_count integer;
  starter_captain_count integer;
begin
  if jsonb_typeof(p_squad) is distinct from 'array' then
    raise exception 'The squad must be an array.';
  end if;

  select
    count(*)::integer,
    count(*) filter (where draft.position = 'starter')::integer,
    count(*) filter (where draft.position = 'bench')::integer,
    count(*) filter (where draft.is_captain)::integer,
    count(*) filter (where draft.is_captain and draft.position = 'starter')::integer
  into squad_count, starter_count, bench_count, captain_count, starter_captain_count
  from jsonb_to_recordset(p_squad) as draft(
    player_id uuid,
    position text,
    is_captain boolean
  );

  if squad_count <> 6 or starter_count <> 4 or bench_count <> 2 then
    raise exception 'Select exactly four main and two bench players before saving.';
  end if;

  if captain_count <> 1 then
    raise exception 'Choose exactly one captain.';
  end if;

  if starter_captain_count <> 1 then
    raise exception 'The captain must be a starting player.';
  end if;

  perform public.save_my_fantasy_team(p_gameweek_id, p_squad, p_chip);
end;
$$;

revoke all on function public.save_my_complete_fantasy_team(uuid, jsonb, text)
from public, anon;
grant execute on function public.save_my_complete_fantasy_team(uuid, jsonb, text)
to authenticated;

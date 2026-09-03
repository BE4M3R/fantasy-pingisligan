-- Require a complete four-starter, two-bench squad when saving and entering a
-- gameweek. Incomplete legacy squads remain editable after transfers reopen,
-- but they do not receive a gameweek snapshot or consume a selected chip.

begin;

-- Squad writes must go through the atomic save RPC. Direct row-by-row writes
-- can otherwise leave a squad incomplete between requests.
drop policy if exists "Users can manage their squad"
on public.fantasy_team_players;

revoke all on function public.save_my_fantasy_team(uuid, jsonb, text)
from public;

revoke execute on function public.save_my_fantasy_team(uuid, jsonb, text)
from anon, authenticated;

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
begin
  if jsonb_typeof(p_squad) is distinct from 'array' then
    raise exception 'The squad must be an array.';
  end if;

  select
    count(*)::integer,
    count(*) filter (where draft.position = 'starter')::integer,
    count(*) filter (where draft.position = 'bench')::integer
  into squad_count, starter_count, bench_count
  from jsonb_to_recordset(p_squad) as draft(
    player_id uuid,
    position text,
    is_captain boolean
  );

  if squad_count <> 6 or starter_count <> 4 or bench_count <> 2 then
    raise exception 'Select exactly four main and two bench players before saving.';
  end if;

  perform public.save_my_fantasy_team(p_gameweek_id, p_squad, p_chip);
end;
$$;

revoke all on function public.save_my_complete_fantasy_team(uuid, jsonb, text)
from public;

grant execute on function public.save_my_complete_fantasy_team(uuid, jsonb, text)
to authenticated;

-- This guard protects the lock job from incomplete squads already stored
-- before this migration was applied.
create or replace function public.skip_incomplete_squad_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  squad_count integer;
  starter_count integer;
  bench_count integer;
begin
  select
    count(*)::integer,
    count(*) filter (where position = 'starter')::integer,
    count(*) filter (where position = 'bench')::integer
  into squad_count, starter_count, bench_count
  from public.fantasy_team_players
  where fantasy_team_id = new.fantasy_team_id;

  if squad_count <> 6 or starter_count <> 4 or bench_count <> 2 then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.skip_incomplete_squad_snapshot() from public;

drop trigger if exists require_complete_squad_for_snapshot
on public.fantasy_team_gameweek_snapshots;

create trigger require_complete_squad_for_snapshot
before insert on public.fantasy_team_gameweek_snapshots
for each row execute function public.skip_incomplete_squad_snapshot();

-- The existing snapshot job tries to lock every pending chip. Remove a chip
-- selection when its team was skipped, so the missed gameweek neither consumes
-- nor reserves that chip for a later gameweek.
create or replace function public.discard_unsnapshotted_chip_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.locked_at is null
    and new.locked_at is not null
    and not exists (
      select 1
      from public.fantasy_team_gameweek_snapshots
      where fantasy_team_id = new.fantasy_team_id
        and fantasy_gameweek_id = new.fantasy_gameweek_id
    ) then
    delete from public.fantasy_team_chip_selections
    where fantasy_team_id = new.fantasy_team_id
      and fantasy_gameweek_id = new.fantasy_gameweek_id;
  end if;

  return new;
end;
$$;

revoke all on function public.discard_unsnapshotted_chip_selection()
from public;

drop trigger if exists discard_chip_without_squad_snapshot
on public.fantasy_team_chip_selections;

create trigger discard_chip_without_squad_snapshot
after update of locked_at on public.fantasy_team_chip_selections
for each row execute function public.discard_unsnapshotted_chip_selection();

commit;

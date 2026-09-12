-- Initial squad selection is unlimited. The first earned free transfer belongs
-- to the window after gameweek one, so the first snapshot must bank zero; the
-- next window adds one in the normal rollover calculation.

alter table public.fantasy_team_gameweek_snapshots
alter column free_transfers_after_lock set default 0;

create or replace function public.correct_new_first_snapshot_transfer_banks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.fantasy_team_gameweek_snapshots as snapshots
  set
    free_transfers_at_lock = null,
    free_transfers_after_lock = 0,
    transfer_penalty_points = 0
  from inserted_snapshots
  join public.fantasy_gameweeks as current_gameweek
    on current_gameweek.id = inserted_snapshots.fantasy_gameweek_id
  where snapshots.fantasy_team_id = inserted_snapshots.fantasy_team_id
    and snapshots.fantasy_gameweek_id = inserted_snapshots.fantasy_gameweek_id
    and not exists (
      select 1
      from public.fantasy_team_gameweek_snapshots as previous_snapshots
      join public.fantasy_gameweeks as previous_gameweek
        on previous_gameweek.id = previous_snapshots.fantasy_gameweek_id
      where previous_snapshots.fantasy_team_id = snapshots.fantasy_team_id
        and previous_snapshots.fantasy_gameweek_id
          <> snapshots.fantasy_gameweek_id
        and previous_gameweek.lock_at < current_gameweek.lock_at
    );

  return null;
end;
$$;

drop trigger if exists correct_new_first_snapshot_transfer_banks
on public.fantasy_team_gameweek_snapshots;

create trigger correct_new_first_snapshot_transfer_banks
after insert on public.fantasy_team_gameweek_snapshots
referencing new table as inserted_snapshots
for each statement execute function public.correct_new_first_snapshot_transfer_banks();

-- Recalculate existing histories in order so environments that have already
-- snapshotted gameweeks receive the same rule, including corrected penalties.
create temporary table corrected_transfer_banks on commit drop as
with recursive ordered_snapshots as (
  select
    snapshots.fantasy_team_id,
    snapshots.fantasy_gameweek_id,
    snapshots.active_chip,
    snapshots.transfer_count_at_lock,
    snapshots.transfer_penalty_points as old_transfer_penalty_points,
    row_number() over (
      partition by snapshots.fantasy_team_id
      order by gameweeks.lock_at, snapshots.fantasy_gameweek_id
    ) as snapshot_number
  from public.fantasy_team_gameweek_snapshots as snapshots
  join public.fantasy_gameweeks as gameweeks
    on gameweeks.id = snapshots.fantasy_gameweek_id
), recalculated as (
  select
    ordered_snapshots.fantasy_team_id,
    ordered_snapshots.fantasy_gameweek_id,
    ordered_snapshots.active_chip,
    ordered_snapshots.transfer_count_at_lock,
    ordered_snapshots.old_transfer_penalty_points,
    ordered_snapshots.snapshot_number,
    null::integer as free_transfers_at_lock,
    0::integer as free_transfers_after_lock,
    0::integer as transfer_penalty_points
  from ordered_snapshots
  where ordered_snapshots.snapshot_number = 1

  union all

  select
    next_snapshot.fantasy_team_id,
    next_snapshot.fantasy_gameweek_id,
    next_snapshot.active_chip,
    next_snapshot.transfer_count_at_lock,
    next_snapshot.old_transfer_penalty_points,
    next_snapshot.snapshot_number,
    least(previous.free_transfers_after_lock + 1, 4) as free_transfers_at_lock,
    case
      when next_snapshot.active_chip = 'wildcard'
        then least(previous.free_transfers_after_lock + 1, 4)
      else greatest(
        least(previous.free_transfers_after_lock + 1, 4)
          - next_snapshot.transfer_count_at_lock,
        0
      )
    end as free_transfers_after_lock,
    case
      when next_snapshot.active_chip = 'wildcard' then 0
      else greatest(
        next_snapshot.transfer_count_at_lock
          - least(previous.free_transfers_after_lock + 1, 4),
        0
      ) * -4
    end as transfer_penalty_points
  from recalculated as previous
  join ordered_snapshots as next_snapshot
    on next_snapshot.fantasy_team_id = previous.fantasy_team_id
    and next_snapshot.snapshot_number = previous.snapshot_number + 1
)
select * from recalculated;

update public.fantasy_team_gameweek_points as points
set
  points = points.points
    - corrected.old_transfer_penalty_points
    + corrected.transfer_penalty_points,
  updated_at = now()
from corrected_transfer_banks as corrected
where points.fantasy_team_id = corrected.fantasy_team_id
  and points.fantasy_gameweek_id = corrected.fantasy_gameweek_id
  and corrected.old_transfer_penalty_points
    is distinct from corrected.transfer_penalty_points;

update public.fantasy_team_gameweek_snapshots as snapshots
set
  free_transfers_at_lock = corrected.free_transfers_at_lock,
  free_transfers_after_lock = corrected.free_transfers_after_lock,
  transfer_penalty_points = corrected.transfer_penalty_points
from corrected_transfer_banks as corrected
where snapshots.fantasy_team_id = corrected.fantasy_team_id
  and snapshots.fantasy_gameweek_id = corrected.fantasy_gameweek_id;

revoke all on function public.correct_new_first_snapshot_transfer_banks() from public;

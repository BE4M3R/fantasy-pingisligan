-- Synthetic schema fixture matching the snapshot objects in both hosted logs.
-- Only definitions are copied from audit history; no archived migration is run.
create or replace function public.snapshot_locked_squads_without_player_roster()
returns table (
  locked_gameweeks integer,
  new_team_snapshots integer,
  new_player_snapshots integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_gameweek_count integer;
  team_snapshot_count integer;
  player_snapshot_count integer;
begin
  select count(*)::integer
  into locked_gameweek_count
  from public.fantasy_gameweeks
  where now() >= lock_at
    and now() <= unlock_at;

  insert into public.fantasy_team_gameweek_snapshots (
    fantasy_team_id,
    fantasy_gameweek_id,
    team_name_at_lock,
    budget_at_lock,
    active_chip,
    transfer_count_at_lock,
    free_transfers_at_lock,
    free_transfers_after_lock,
    transfer_penalty_points
  )
  select
    fantasy_teams.id,
    fantasy_gameweeks.id,
    fantasy_teams.name,
    fantasy_teams.budget,
    chip_selections.chip,
    coalesce(transfer_usage.transfer_count, 0),
    transfer_bank.free_transfers_at_lock,
    case
      when previous_snapshot.fantasy_gameweek_id is null then 1
      when chip_selections.chip = 'wildcard' then transfer_bank.free_transfers_at_lock
      else greatest(
        transfer_bank.free_transfers_at_lock - coalesce(transfer_usage.transfer_count, 0),
        0
      )
    end,
    case
      when previous_snapshot.fantasy_gameweek_id is null
        or chip_selections.chip = 'wildcard' then 0
      else greatest(
        coalesce(transfer_usage.transfer_count, 0) - transfer_bank.free_transfers_at_lock,
        0
      ) * -4
    end
  from public.fantasy_gameweeks
  cross join public.fantasy_teams
  left join public.fantasy_team_chip_selections as chip_selections
    on chip_selections.fantasy_team_id = fantasy_teams.id
    and chip_selections.fantasy_gameweek_id = fantasy_gameweeks.id
    and chip_selections.locked_at is null
  left join lateral (
    select
      previous_snapshots.fantasy_gameweek_id,
      previous_snapshots.free_transfers_after_lock
    from public.fantasy_team_gameweek_snapshots as previous_snapshots
    join public.fantasy_gameweeks as previous_gameweeks
      on previous_gameweeks.id = previous_snapshots.fantasy_gameweek_id
    where previous_snapshots.fantasy_team_id = fantasy_teams.id
      and previous_gameweeks.lock_at < fantasy_gameweeks.lock_at
    order by previous_gameweeks.lock_at desc
    limit 1
  ) as previous_snapshot on true
  left join lateral (
    select
      case
        when previous_snapshot.fantasy_gameweek_id is null then null
        else least(previous_snapshot.free_transfers_after_lock + 1, 4)
      end as free_transfers_at_lock
  ) as transfer_bank on true
  left join lateral (
    select count(*)::integer as transfer_count
    from public.fantasy_team_players as current_squad
    where current_squad.fantasy_team_id = fantasy_teams.id
      and previous_snapshot.fantasy_gameweek_id is not null
      and not exists (
        select 1
        from public.fantasy_team_gameweek_players as previous_players
        where previous_players.fantasy_team_id = fantasy_teams.id
          and previous_players.fantasy_gameweek_id = previous_snapshot.fantasy_gameweek_id
          and previous_players.player_id = current_squad.player_id
      )
  ) as transfer_usage on true
  where now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at
    and fantasy_teams.created_at <= fantasy_gameweeks.lock_at
  on conflict (fantasy_team_id, fantasy_gameweek_id) do nothing;

  get diagnostics team_snapshot_count = row_count;

  update public.fantasy_team_gameweek_snapshots as snapshots
  set active_chip = chip_selections.chip
  from public.fantasy_team_chip_selections as chip_selections
  join public.fantasy_gameweeks
    on fantasy_gameweeks.id = chip_selections.fantasy_gameweek_id
  where snapshots.fantasy_team_id = chip_selections.fantasy_team_id
    and snapshots.fantasy_gameweek_id = chip_selections.fantasy_gameweek_id
    and snapshots.active_chip is null
    and chip_selections.locked_at is null
    and now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at;

  update public.fantasy_team_chip_selections as chip_selections
  set locked_at = now()
  from public.fantasy_gameweeks
  where fantasy_gameweeks.id = chip_selections.fantasy_gameweek_id
    and chip_selections.locked_at is null
    and now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at;

  insert into public.fantasy_team_gameweek_players (
    fantasy_team_id,
    fantasy_gameweek_id,
    player_id,
    club_id_at_lock,
    player_first_name_at_lock,
    player_last_name_at_lock,
    club_name_at_lock,
    position,
    is_captain,
    price_at_lock
  )
  select
    snapshots.fantasy_team_id,
    snapshots.fantasy_gameweek_id,
    squad.player_id,
    players.club_id,
    players.first_name,
    players.last_name,
    clubs.name,
    squad.position,
    squad.is_captain,
    players.price
  from public.fantasy_team_gameweek_snapshots as snapshots
  join public.fantasy_gameweeks
    on fantasy_gameweeks.id = snapshots.fantasy_gameweek_id
  join public.fantasy_team_players as squad
    on squad.fantasy_team_id = snapshots.fantasy_team_id
  join public.players
    on players.id = squad.player_id
  left join public.clubs
    on clubs.id = players.club_id
  where now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at
  on conflict (fantasy_team_id, fantasy_gameweek_id, player_id) do nothing;

  get diagnostics player_snapshot_count = row_count;

  return query
  select locked_gameweek_count, team_snapshot_count, player_snapshot_count;
end;
$$;
create or replace function public.snapshot_locked_squads()
returns table (
  locked_gameweeks integer,
  new_team_snapshots integer,
  new_player_snapshots integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.player_gameweek_club_snapshots (
    fantasy_gameweek_id,
    player_id,
    club_id_at_lock,
    active_at_lock
  )
  select
    fantasy_gameweeks.id,
    players.id,
    players.club_id,
    players.active
  from public.fantasy_gameweeks
  cross join public.players
  where now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at
  on conflict (fantasy_gameweek_id, player_id) do nothing;

  return query
  select
    previous_result.locked_gameweeks,
    previous_result.new_team_snapshots,
    previous_result.new_player_snapshots
  from public.snapshot_locked_squads_without_player_roster() as previous_result;
end;
$$;
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
create trigger require_complete_squad_for_snapshot
before insert on public.fantasy_team_gameweek_snapshots
for each row execute function public.skip_incomplete_squad_snapshot();
create trigger discard_chip_without_squad_snapshot
after update of locked_at on public.fantasy_team_chip_selections
for each row execute function public.discard_unsnapshotted_chip_selection();
revoke all on function public.snapshot_locked_squads_without_player_roster() from public;
grant execute on function public.snapshot_locked_squads_without_player_roster(),
  public.skip_incomplete_squad_snapshot(), public.discard_unsnapshotted_chip_selection()
to anon, authenticated, postgres, service_role;

-- Freeze each player's club and availability per gameweek so historical
-- fixture-win bonuses do not change after later player imports or transfers.
-- Run player-identity-migration.sql before this migration.

begin;

create table if not exists public.player_gameweek_club_snapshots (
  fantasy_gameweek_id uuid not null references public.fantasy_gameweeks(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  club_id_at_lock uuid references public.clubs(id) on delete set null,
  active_at_lock boolean not null,
  snapshotted_at timestamptz not null default now(),
  primary key (fantasy_gameweek_id, player_id)
);

drop index if exists public.player_gameweek_club_snapshots_active_club_idx;

create index if not exists player_gameweek_club_snapshots_club_idx
on public.player_gameweek_club_snapshots (fantasy_gameweek_id, club_id_at_lock);

alter table public.player_gameweek_club_snapshots enable row level security;

-- Existing locked fantasy squads contain the most reliable historical club
-- value available for a player. Treat those players as eligible at that lock.
insert into public.player_gameweek_club_snapshots (
  fantasy_gameweek_id,
  player_id,
  club_id_at_lock,
  active_at_lock,
  snapshotted_at
)
select distinct on (
  snapshot_players.fantasy_gameweek_id,
  snapshot_players.player_id
)
  snapshot_players.fantasy_gameweek_id,
  snapshot_players.player_id,
  snapshot_players.club_id_at_lock,
  true,
  snapshot_players.created_at
from public.fantasy_team_gameweek_players as snapshot_players
order by
  snapshot_players.fantasy_gameweek_id,
  snapshot_players.player_id,
  (snapshot_players.club_id_at_lock is null),
  snapshot_players.created_at
on conflict (fantasy_gameweek_id, player_id) do nothing;

-- Complete older rosters as a best-effort backfill. For players no fantasy
-- team owned, only the current club is available before this migration exists.
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
where fantasy_gameweeks.lock_at <= now()
  and players.created_at <= fantasy_gameweeks.lock_at
on conflict (fantasy_gameweek_id, player_id) do nothing;

-- Preserve the existing squad-snapshot implementation and put a roster
-- snapshot in front of it. The public RPC and Cron command keep the same name.
alter function public.snapshot_locked_squads()
rename to snapshot_locked_squads_without_player_roster;

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

revoke all on function public.snapshot_locked_squads() from public;
grant execute on function public.snapshot_locked_squads() to service_role;

-- Duplicate-player reconciliation must move immutable roster history before
-- deleting the duplicate application player ID.
create or replace function public.merge_player_records(
  keep_player_id uuid,
  duplicate_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep_role_id integer;
  duplicate_role_id integer;
begin
  if keep_player_id is null
    or duplicate_player_id is null
    or keep_player_id = duplicate_player_id then
    raise exception 'Choose two different player records to merge.';
  end if;

  select players.stupa_user_role_id
  into keep_role_id
  from public.players
  where players.id = keep_player_id
  for update;

  if not found then
    raise exception 'The player record to keep was not found.';
  end if;

  select players.stupa_user_role_id
  into duplicate_role_id
  from public.players
  where players.id = duplicate_player_id
  for update;

  if not found then
    raise exception 'The duplicate player record was not found.';
  end if;

  if exists (
    select 1
    from public.fantasy_team_players as duplicate_squad
    join public.fantasy_team_players as kept_squad
      on kept_squad.fantasy_team_id = duplicate_squad.fantasy_team_id
      and kept_squad.player_id = keep_player_id
    where duplicate_squad.player_id = duplicate_player_id
  ) then
    raise exception 'A fantasy team currently owns both player records.';
  end if;

  if exists (
    select 1
    from public.fantasy_team_gameweek_players as duplicate_snapshot
    join public.fantasy_team_gameweek_players as kept_snapshot
      on kept_snapshot.fantasy_team_id = duplicate_snapshot.fantasy_team_id
      and kept_snapshot.fantasy_gameweek_id =
        duplicate_snapshot.fantasy_gameweek_id
      and kept_snapshot.player_id = keep_player_id
    where duplicate_snapshot.player_id = duplicate_player_id
  ) then
    raise exception 'A locked fantasy squad contains both player records.';
  end if;

  if exists (
    select 1
    from public.player_match_stats as duplicate_stats
    join public.player_match_stats as kept_stats
      on kept_stats.match_id = duplicate_stats.match_id
      and kept_stats.player_id = keep_player_id
    where duplicate_stats.player_id = duplicate_player_id
  ) then
    raise exception 'A match contains statistics for both player records.';
  end if;

  if exists (
    select 1
    from public.player_gameweek_club_snapshots as duplicate_roster
    join public.player_gameweek_club_snapshots as kept_roster
      on kept_roster.fantasy_gameweek_id = duplicate_roster.fantasy_gameweek_id
      and kept_roster.player_id = keep_player_id
    where duplicate_roster.player_id = duplicate_player_id
      and kept_roster.club_id_at_lock is distinct from duplicate_roster.club_id_at_lock
      and kept_roster.club_id_at_lock is not null
      and duplicate_roster.club_id_at_lock is not null
  ) then
    raise exception 'The player records have conflicting locked club histories.';
  end if;

  update public.fantasy_team_players
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  update public.fantasy_team_gameweek_players
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  update public.player_gameweek_club_snapshots as kept_roster
  set club_id_at_lock = coalesce(
        kept_roster.club_id_at_lock,
        duplicate_roster.club_id_at_lock
      ),
      active_at_lock = kept_roster.active_at_lock or duplicate_roster.active_at_lock
  from public.player_gameweek_club_snapshots as duplicate_roster
  where kept_roster.player_id = keep_player_id
    and duplicate_roster.player_id = duplicate_player_id
    and duplicate_roster.fantasy_gameweek_id = kept_roster.fantasy_gameweek_id;

  delete from public.player_gameweek_club_snapshots as duplicate_roster
  where duplicate_roster.player_id = duplicate_player_id
    and exists (
      select 1
      from public.player_gameweek_club_snapshots as kept_roster
      where kept_roster.fantasy_gameweek_id = duplicate_roster.fantasy_gameweek_id
        and kept_roster.player_id = keep_player_id
    );

  update public.player_gameweek_club_snapshots
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  update public.player_match_stats
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  update public.player_submatch_results
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  update public.player_external_identities as duplicate_identity
  set is_current = false
  where duplicate_identity.player_id = duplicate_player_id
    and duplicate_identity.is_current
    and exists (
      select 1
      from public.player_external_identities as kept_identity
      where kept_identity.player_id = keep_player_id
        and kept_identity.provider = duplicate_identity.provider
        and kept_identity.is_current
    );

  update public.player_external_identities
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  if keep_role_id is null and duplicate_role_id is not null then
    update public.players
    set stupa_user_role_id = null
    where id = duplicate_player_id;

    update public.players
    set stupa_user_role_id = duplicate_role_id
    where id = keep_player_id;
  end if;

  delete from public.players
  where id = duplicate_player_id;
end;
$$;

revoke all on function public.merge_player_records(uuid, uuid) from public;
grant execute on function public.merge_player_records(uuid, uuid)
to service_role;

create or replace function public.calculate_player_match_stats(target_gameweek_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_stat_count integer;
begin
  delete from public.player_match_stats
  using public.matches
  where matches.id = player_match_stats.match_id
    and matches.fantasy_gameweek_id = target_gameweek_id;

  with side_sizes as (
    select
      results.stupa_submatch_id,
      results.team_stupa_participant_id,
      count(*)::integer as player_count
    from public.player_submatch_results as results
    group by results.stupa_submatch_id, results.team_stupa_participant_id
  ),
  submatch_context as (
    select
      submatches.stupa_submatch_id,
      submatches.match_id,
      bool_or(side_sizes.player_count > 1) as is_doubles,
      bool_or(
        results.walkover
        or nullif(results.raw_payload #>> '{side,walkover_reason}', '') is not null
      ) as is_walkover
    from public.stupa_submatches as submatches
    join public.matches
      on matches.id = submatches.match_id
      and matches.fantasy_gameweek_id = target_gameweek_id
    join public.player_submatch_results as results
      on results.stupa_submatch_id = submatches.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where upper(submatches.status) = 'SCORED'
    group by submatches.stupa_submatch_id, submatches.match_id
  ),
  result_points as (
    select
      context.match_id,
      results.player_id,
      context.is_doubles,
      results.won,
      case
        when context.is_walkover and results.won then 3
        when context.is_walkover then 0
        else results.sets_won
      end as won_sets,
      case when context.is_walkover then 0 else results.sets_lost end as lost_sets,
      case
        when context.is_doubles then
          (case when results.won then 2 else 0 end)
          + ceil(
              (
                case
                  when context.is_walkover and results.won then 3
                  when context.is_walkover then 0
                  else results.sets_won
                end
              )::numeric / side_sizes.player_count
            )::integer
        when context.is_walkover then case when results.won then 7 else 0 end
        else
          (case when results.won then 4 else 0 end)
          + results.sets_won
      end as points
    from submatch_context as context
    join public.player_submatch_results as results
      on results.stupa_submatch_id = context.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where results.player_id is not null
  ),
  result_totals as (
    select
      match_id,
      player_id,
      count(*) filter (where won)::integer as won_matches,
      count(*) filter (where not won)::integer as lost_matches,
      sum(won_sets)::integer as won_sets,
      sum(lost_sets)::integer as lost_sets,
      sum(points)::integer as points
    from result_points
    group by match_id, player_id
  ),
  singles_bonus as (
    select
      result_points.player_id,
      min(result_points.match_id::text)::uuid as bonus_match_id
    from result_points
    where not result_points.is_doubles
    group by result_points.player_id
    having count(*) >= 2 and bool_and(result_points.won)
  ),
  winning_clubs as (
    select
      matches.id as match_id,
      case
        when lower(matches.status) = 'scored'
          and matches.winning_team_stupa_participant_id =
          matches.home_team_stupa_participant_id then matches.home_club_id
        when lower(matches.status) = 'scored'
          and matches.winning_team_stupa_participant_id =
          matches.away_team_stupa_participant_id then matches.away_club_id
      end as club_id
    from public.matches
    where matches.fantasy_gameweek_id = target_gameweek_id
  ),
  gameweek_roster as (
    select
      roster.player_id,
      roster.club_id_at_lock,
      roster.active_at_lock
        or exists (
          select 1
          from public.fantasy_team_gameweek_players as owned_snapshot
          where owned_snapshot.fantasy_gameweek_id = target_gameweek_id
            and owned_snapshot.player_id = roster.player_id
        ) as eligible_for_club_bonus
    from public.player_gameweek_club_snapshots as roster
    where roster.fantasy_gameweek_id = target_gameweek_id
  ),
  match_players as (
    select result_totals.match_id, result_totals.player_id
    from result_totals
    union
    select winning_clubs.match_id, gameweek_roster.player_id
    from winning_clubs
    join gameweek_roster
      on gameweek_roster.club_id_at_lock = winning_clubs.club_id
      and gameweek_roster.eligible_for_club_bonus
  )
  insert into public.player_match_stats (
    match_id,
    player_id,
    won_matches,
    lost_matches,
    won_sets,
    lost_sets,
    fantasy_points
  )
  select
    match_players.match_id,
    match_players.player_id,
    coalesce(result_totals.won_matches, 0),
    coalesce(result_totals.lost_matches, 0),
    coalesce(result_totals.won_sets, 0),
    coalesce(result_totals.lost_sets, 0),
    coalesce(result_totals.points, 0)
      + case
          when gameweek_roster.eligible_for_club_bonus
            and winning_clubs.club_id = gameweek_roster.club_id_at_lock then 3
          else 0
        end
      + case when singles_bonus.bonus_match_id = match_players.match_id then 2 else 0 end
  from match_players
  left join result_totals
    on result_totals.match_id = match_players.match_id
    and result_totals.player_id = match_players.player_id
  left join winning_clubs on winning_clubs.match_id = match_players.match_id
  left join gameweek_roster on gameweek_roster.player_id = match_players.player_id
  left join singles_bonus on singles_bonus.player_id = match_players.player_id;

  get diagnostics inserted_stat_count = row_count;
  return inserted_stat_count;
end;
$$;

revoke all on function public.calculate_player_match_stats(uuid) from public;
grant execute on function public.calculate_player_match_stats(uuid) to service_role;

commit;

-- Reconcile the pre-baseline hosted snapshot implementation without replaying
-- old migrations, changing stored game data, or replacing the public RPC's OID.
-- Fail and roll back rather than waiting indefinitely or removing dependencies.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- SQL-language/PLpgSQL bodies and Cron strings are not all represented in
-- pg_depend. Refuse cleanup if another database caller still uses these names.
do $$
begin
  if exists (
    select 1 from pg_proc as functions
    where not (functions.pronamespace = 'public'::regnamespace
      and functions.proname in (
        'snapshot_locked_squads', 'snapshot_locked_squads_without_player_roster',
        'skip_incomplete_squad_snapshot', 'discard_unsnapshotted_chip_selection'
      ))
      and functions.prosrc ~* '(snapshot_locked_squads_without_player_roster|skip_incomplete_squad_snapshot|discard_unsnapshotted_chip_selection)'
  ) or exists (
    select 1 from cron.job
    where command ~* '(snapshot_locked_squads_without_player_roster|skip_incomplete_squad_snapshot|discard_unsnapshotted_chip_selection)'
  ) then
    raise exception 'Unexpected caller of a legacy snapshot helper; review dependencies before deployment.';
  end if;
  if exists (
    select 1
    from (values
      ('public.fantasy_team_gameweek_snapshots'::regclass,
       'require_complete_squad_for_snapshot', 'public.skip_incomplete_squad_snapshot()', 7),
      ('public.fantasy_team_chip_selections'::regclass,
       'discard_chip_without_squad_snapshot', 'public.discard_unsnapshotted_chip_selection()', 17)
    ) as expected(table_id, trigger_name, function_name, trigger_type)
    join pg_trigger as triggers on triggers.tgrelid = expected.table_id
      and triggers.tgname = expected.trigger_name
    where triggers.tgfoid is distinct from to_regprocedure(expected.function_name)::oid
      or triggers.tgtype <> expected.trigger_type
      or triggers.tgqual is not null or triggers.tgnargs <> 0
      or triggers.tgenabled <> 'O'
  ) then
    raise exception 'Unexpected legacy trigger definition; refusing schema reconciliation.';
  end if;
end;
$$;

-- SQL editor submissions can retain CRLF line endings and padding around the
-- function body. Normalize only that formatting on the baseline functions
-- reported by the hosted checks. Preserve each live body, signature, security
-- settings, and grants; do not replay obsolete scoring/save implementations.
do $normalize$
declare
  signature text;
  original_body text;
  normalized_body text;
  definition text;
begin
  foreach signature in array array[
    'public.create_private_league(text)', 'public.join_private_league(text)',
    'public.current_transfer_lock()', 'public.delete_current_user()',
    'public.email_is_registered(text)', 'public.enforce_fantasy_team_club_limit()',
    'public.enforce_transfer_refresh_lock()', 'public.get_my_gameweek_progress()',
    'public.get_my_played_gameweek_progress()', 'public.mark_used_chips()',
    'public.merge_player_records(uuid,uuid)', 'public.preserve_team_cash_on_player_reprice()',
    'public.get_my_latest_squad_result_without_lineup_order()',
    'public.get_my_latest_squad_set_breakdown()',
    'public.get_my_squad_result_without_lineup_order(uuid)',
    'public.get_my_squad_set_breakdown(uuid)',
    'public.save_my_fantasy_team_without_lineup_order(uuid,jsonb,text)',
    'public.transfers_are_locked()'
  ] loop
    select prosrc, pg_get_functiondef(oid) into strict original_body, definition
    from pg_proc where oid = signature::regprocedure;
    normalized_body := btrim(replace(original_body, E'\r\n', E'\n'), E' \t\r\n');
    if normalized_body = original_body then continue; end if;
    -- Never change the content of a multiline literal. These known functions
    -- use ordinary single-line strings; unusual bodies require manual review.
    if original_body ~ '\$[[:alnum:]_]*\$' or original_body ~* '\mE''' or exists (
      select 1 from regexp_matches(original_body, $pattern$'(?:[^']|'')*'$pattern$, 'g') as quoted(literal)
      where literal[1] ~ E'[\r\n]'
    ) then
      raise exception 'Unexpected literal in baseline function %; refusing formatting normalization.', signature;
    end if;
    execute replace(definition, original_body, normalized_body);
  end loop;
end;
$normalize$;

-- Same implementation as the tracked baseline. The later transfer-bank and
-- lineup-order triggers remain in place; CREATE OR REPLACE preserves callers.
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
  join lateral (
    select true as is_complete
    from public.fantasy_team_players as selected_players
    where selected_players.fantasy_team_id = fantasy_teams.id
    having count(*) = 6
      and count(*) filter (where selected_players.position = 'starter') = 4
      and count(*) filter (where selected_players.position = 'bench') = 2
  ) as complete_squad on true
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
    and now() <= fantasy_gameweeks.unlock_at
    and exists (
      select 1
      from public.fantasy_team_gameweek_snapshots as snapshots
      where snapshots.fantasy_team_id = chip_selections.fantasy_team_id
        and snapshots.fantasy_gameweek_id = chip_selections.fantasy_gameweek_id
    );

  delete from public.fantasy_team_chip_selections as chip_selections
  using public.fantasy_gameweeks
  where fantasy_gameweeks.id = chip_selections.fantasy_gameweek_id
    and chip_selections.locked_at is null
    and now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at
    and not exists (
      select 1
      from public.fantasy_team_gameweek_snapshots as snapshots
      where snapshots.fantasy_team_id = chip_selections.fantasy_team_id
        and snapshots.fantasy_gameweek_id = chip_selections.fantasy_gameweek_id
    );

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

revoke execute on function public.snapshot_locked_squads()
from public, anon, authenticated;
grant execute on function public.snapshot_locked_squads() to service_role;

-- Completeness and unused-chip handling are already inside the canonical RPC.
-- RESTRICT is deliberate: unexpected dependencies abort the entire migration.
drop trigger if exists require_complete_squad_for_snapshot
on public.fantasy_team_gameweek_snapshots;
drop trigger if exists discard_chip_without_squad_snapshot
on public.fantasy_team_chip_selections;
drop function if exists public.skip_incomplete_squad_snapshot() restrict;
drop function if exists public.discard_unsnapshotted_chip_selection() restrict;
drop function if exists public.snapshot_locked_squads_without_player_roster() restrict;

-- Retain the useful production stage indexes and make them reproducible.
create index if not exists fantasy_gameweeks_stupa_stage_id_idx
on public.fantasy_gameweeks (stupa_stage_id);
create index if not exists matches_stupa_stage_id_idx
on public.matches (stupa_stage_id);

do $$
declare
  column_name text;
  key_name text;
  index_definition text;
  constraint_definition text;
begin
  if pg_get_indexdef('public.fantasy_gameweeks_stupa_stage_id_idx'::regclass)
       <> 'CREATE INDEX fantasy_gameweeks_stupa_stage_id_idx ON public.fantasy_gameweeks USING btree (stupa_stage_id)'
     or pg_get_indexdef('public.matches_stupa_stage_id_idx'::regclass)
       <> 'CREATE INDEX matches_stupa_stage_id_idx ON public.matches USING btree (stupa_stage_id)' then
    raise exception 'Unexpected stage index definition; refusing schema reconciliation.';
  end if;

  -- Fresh/staging databases already have the baseline UNIQUE constraints.
  -- Production has standalone unique indexes. Adopt the full license index;
  -- replace the partial role index with full uniqueness before removing it.
  -- NULL values remain allowed and distinct. No identity or player rows change.
  foreach column_name in array array['profixio_id', 'stupa_user_role_id'] loop
    key_name := 'players_' || column_name || '_key';
    select pg_get_constraintdef(oid) into constraint_definition
    from pg_constraint
    where conrelid = 'public.players'::regclass and conname = key_name;
    if found then
      if constraint_definition <> format('UNIQUE (%I)', column_name) then
        raise exception 'Unexpected player identity constraint; refusing schema reconciliation.';
      end if;
      continue;
    end if;

    index_definition := pg_get_indexdef(to_regclass('public.' || key_name));
    if index_definition = format('CREATE UNIQUE INDEX %I ON public.players USING btree (%I)', key_name, column_name) then
      execute format('alter table public.players add constraint %I unique using index %I', key_name, key_name);
    elsif column_name = 'stupa_user_role_id' and index_definition =
      'CREATE UNIQUE INDEX players_stupa_user_role_id_key ON public.players USING btree (stupa_user_role_id) WHERE (stupa_user_role_id IS NOT NULL)' then
      -- Building the replacement first retains the existing uniqueness guarantee.
      create unique index players_stupa_user_role_id_reconciled_idx
      on public.players (stupa_user_role_id);
      drop index public.players_stupa_user_role_id_key restrict;
      alter table public.players add constraint players_stupa_user_role_id_key
      unique using index players_stupa_user_role_id_reconciled_idx;
    else
      raise exception 'Missing or unexpected player identity index; refusing schema reconciliation.';
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;

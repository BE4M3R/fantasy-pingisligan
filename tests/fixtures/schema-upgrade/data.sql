-- Every fixture runs in one rollback-only transaction on a disposable stack.
-- Compare definitions (not OIDs) so rebuilt/adopted indexes can converge.
create function pg_temp.schema_state() returns jsonb language sql as $$
  select jsonb_build_object(
    'functions', (select jsonb_agg(jsonb_build_array(proname,
      pg_get_functiondef(oid), (select jsonb_agg(acl::text order by acl::text)
        from unnest(proacl) as acl)) order by oid::regprocedure::text)
      from pg_proc where pronamespace = 'public'::regnamespace),
    'indexes', (select jsonb_agg(pg_get_indexdef(indexrelid) order by indexrelid::regclass::text)
      from pg_index join pg_class on pg_class.oid = indexrelid
      where relnamespace = 'public'::regnamespace),
    'constraints', (select jsonb_agg(jsonb_build_array(conrelid::regclass::text,
      conname, pg_get_constraintdef(oid)) order by conrelid::regclass::text, conname)
      from pg_constraint where connamespace = 'public'::regnamespace),
    'triggers', (select jsonb_agg(pg_get_triggerdef(oid) order by tgrelid::regclass::text, tgname)
      from pg_trigger where not tgisinternal and tgrelid in
      (select oid from pg_class where relnamespace = 'public'::regnamespace)),
    'cron', (select jsonb_agg(jsonb_build_array(jobname, schedule, command, active) order by jobname)
      from cron.job)
  );
$$;

create function pg_temp.data_state() returns jsonb language plpgsql as $$
declare
  relation regclass;
  row_hash text;
  result jsonb := '{}';
begin
  for relation in select oid::regclass from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
    union all select 'auth.users'::regclass
  loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text, %L)) from %s r',
      '[]', relation) into row_hash;
    result := result || jsonb_build_object(relation::text, row_hash);
  end loop;
  return result;
end;
$$;

create temporary table expected_schema as select pg_temp.schema_state() as state,
  'public.snapshot_locked_squads()'::regprocedure::oid as snapshot_oid;

create function pg_temp.assert_canonical_schema() returns void language plpgsql as $$
begin
  if pg_temp.schema_state() is distinct from (select state from expected_schema) then
    raise exception 'Upgraded schema differs from the fresh migration rebuild';
  end if;
  if 'public.snapshot_locked_squads()'::regprocedure::oid <>
    (select snapshot_oid from expected_schema) then
    raise exception 'Snapshot RPC identity changed';
  end if;
end;
$$;

create temporary table observed_state (data jsonb, schema jsonb);
create function pg_temp.remember_state() returns void language plpgsql as $$
begin
  insert into observed_state values (pg_temp.data_state(), pg_temp.schema_state());
end;
$$;
create function pg_temp.assert_unchanged(include_schema boolean) returns void language plpgsql as $$
begin
  if pg_temp.data_state() is distinct from (select data from observed_state) then
    raise exception 'Reconciliation changed stored application data or Auth users';
  end if;
  if include_schema and pg_temp.schema_state() is distinct from (select schema from observed_state) then
    raise exception 'Rejected migration did not roll back every schema change';
  end if;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data)
select md5('schema-upgrade-user-' || i)::uuid, 'schema-upgrade-' || i || '@example.invalid', '{}'
from generate_series(1, 3) i;
insert into public.fantasy_teams (id, user_id, name, onboarding_completed, created_at)
select md5('schema-upgrade-team-' || i)::uuid, md5('schema-upgrade-user-' || i)::uuid,
  'Schema upgrade ' || i, true, now() - interval '4 hours'
from generate_series(1, 3) i;
insert into public.players (id, first_name, last_name, price, profixio_id, stupa_user_role_id)
select md5('schema-upgrade-player-' || i)::uuid, 'Schema', 'Player ' || i, 10000000,
  'schema-upgrade-' || i, case when i <= 4 then -2147000000 - i end
from generate_series(1, 6) i;
insert into public.fantasy_team_players (fantasy_team_id, player_id, position, is_captain, lineup_order)
select md5('schema-upgrade-team-' || team)::uuid, md5('schema-upgrade-player-' || player)::uuid,
  case when player <= 4 then 'starter' else 'bench' end, player = 1, player - 1
from generate_series(1, 3) team cross join generate_series(1, 6) player
where team <> 3 or player <= 5;
insert into public.fantasy_gameweeks (id, stupa_round_id, name, round_order,
  first_match_starts_at, last_match_ends_at, lock_at, unlock_at, data_refreshed_at)
values
  (md5('schema-upgrade-old-week')::uuid, -2147000100, 'Upgrade history', 1,
    now() - interval '3 hours', now() - interval '2 hours',
    now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 hour'),
  (md5('schema-upgrade-new-week')::uuid, -2147000101, 'Upgrade pending lock', 2,
    now() + interval '1 hour', now() + interval '2 hours',
    now() - interval '5 minutes', now() + interval '2 hours', null);
insert into public.fantasy_team_gameweek_snapshots (fantasy_team_id, fantasy_gameweek_id,
  team_name_at_lock, budget_at_lock, active_chip, free_transfers_after_lock)
values (md5('schema-upgrade-team-1')::uuid, md5('schema-upgrade-old-week')::uuid,
  'Historical name', 90000000, 'triple_captain', 2);
-- Deliberately nonzero history: reconciliation must never rerun an old data repair.
update public.fantasy_team_gameweek_snapshots set free_transfers_after_lock = 2
where fantasy_gameweek_id = md5('schema-upgrade-old-week')::uuid;
insert into public.fantasy_team_gameweek_players (fantasy_team_id, fantasy_gameweek_id,
  player_id, player_first_name_at_lock, player_last_name_at_lock, price_at_lock,
  position, is_captain, lineup_order, fantasy_points)
select fantasy_team_id, md5('schema-upgrade-old-week')::uuid, player_id, 'Old', 'Name',
  9000000, position, is_captain, lineup_order, 9
from public.fantasy_team_players where fantasy_team_id = md5('schema-upgrade-team-1')::uuid;
insert into public.fantasy_team_gameweek_points (fantasy_team_id, fantasy_gameweek_id, points)
values (md5('schema-upgrade-team-1')::uuid, md5('schema-upgrade-old-week')::uuid, 42);
insert into public.fantasy_team_chip_selections (fantasy_team_id, fantasy_gameweek_id, chip)
select md5('schema-upgrade-team-' || i)::uuid, md5('schema-upgrade-new-week')::uuid,
  case when i = 1 then 'wildcard' when i = 2 then 'triple_captain' else 'bench_boost' end
from generate_series(1, 3) i;

create temporary table historical_rows as
select to_jsonb(s) as row from public.fantasy_team_gameweek_snapshots s
where fantasy_gameweek_id = md5('schema-upgrade-old-week')::uuid
union all select to_jsonb(p) from public.fantasy_team_gameweek_players p
where fantasy_gameweek_id = md5('schema-upgrade-old-week')::uuid
union all select to_jsonb(p) from public.fantasy_team_gameweek_points p
where fantasy_gameweek_id = md5('schema-upgrade-old-week')::uuid;

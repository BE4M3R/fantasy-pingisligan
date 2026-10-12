select pg_temp.assert_canonical_schema();
do $$
begin
  if has_function_privilege('anon', 'public.snapshot_locked_squads()', 'execute')
    or has_function_privilege('authenticated', 'public.snapshot_locked_squads()', 'execute')
    or not has_function_privilege('service_role', 'public.snapshot_locked_squads()', 'execute')
    or to_regprocedure('public.snapshot_locked_squads_without_player_roster()') is not null then
    raise exception 'Snapshot permissions permit an untrusted administrative path';
  end if;
end;
$$;

-- Call with the real job role, not just a superuser bypassing the grants/RLS.
set local role service_role;
select public.snapshot_locked_squads();
reset role;

do $$
declare
  repeated record;
begin
  if (select count(*) from public.fantasy_team_gameweek_snapshots
      where fantasy_gameweek_id = md5('schema-upgrade-new-week')::uuid) <> 2
    or (select count(*) from public.fantasy_team_gameweek_players
      where fantasy_gameweek_id = md5('schema-upgrade-new-week')::uuid) <> 12
    or (select count(*) from public.player_gameweek_club_snapshots
      where fantasy_gameweek_id = md5('schema-upgrade-new-week')::uuid) < 6 then
    raise exception 'Snapshot job did not capture complete squads and the roster';
  end if;
  if exists (select 1 from public.fantasy_team_chip_selections
      where fantasy_team_id = md5('schema-upgrade-team-3')::uuid)
    or (select count(*) from public.fantasy_team_chip_selections
      where fantasy_gameweek_id = md5('schema-upgrade-new-week')::uuid
      and locked_at is not null and used_at is null) <> 2 then
    raise exception 'Chip selection was consumed for an incomplete squad or not locked for complete squads';
  end if;
  if (select free_transfers_after_lock from public.fantasy_team_gameweek_snapshots
      where fantasy_team_id = md5('schema-upgrade-team-1')::uuid
      and fantasy_gameweek_id = md5('schema-upgrade-new-week')::uuid) <> 3
    or (select free_transfers_after_lock from public.fantasy_team_gameweek_snapshots
      where fantasy_team_id = md5('schema-upgrade-team-2')::uuid) <> 0 then
    raise exception 'Existing transfer history or first-entry bank changed';
  end if;
  if exists (select 1 from public.fantasy_team_gameweek_players locked
      join public.fantasy_team_players live using (fantasy_team_id, player_id)
      where locked.fantasy_gameweek_id = md5('schema-upgrade-new-week')::uuid
      and (locked.lineup_order <> live.lineup_order or locked.position <> live.position
        or locked.is_captain <> live.is_captain)) then
    raise exception 'Locked lineup or captain differs from the saved squad';
  end if;
  select * into repeated from public.snapshot_locked_squads();
  if repeated.new_team_snapshots <> 0 or repeated.new_player_snapshots <> 0 then
    raise exception 'Repeated snapshot job is not idempotent';
  end if;
  if exists (
    (select row from historical_rows except
      (select to_jsonb(s) from public.fantasy_team_gameweek_snapshots s
        where fantasy_gameweek_id = md5('schema-upgrade-old-week')::uuid
       union all select to_jsonb(p) from public.fantasy_team_gameweek_players p
        where fantasy_gameweek_id = md5('schema-upgrade-old-week')::uuid
       union all select to_jsonb(p) from public.fantasy_team_gameweek_points p
        where fantasy_gameweek_id = md5('schema-upgrade-old-week')::uuid))
  ) then
    raise exception 'Historical locked squads or stored points changed';
  end if;
  if exists (select 1 from public.fantasy_teams
      where name like 'Schema upgrade %' and budget <> 100000000)
    or exists (select 1 from public.players where profixio_id like 'schema-upgrade-%'
      and price <> 10000000) then
    raise exception 'Snapshot job changed prices or budgets';
  end if;
end;
$$;

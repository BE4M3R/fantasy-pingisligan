-- Exercise both the public complete-save entry point and its restricted helper.
-- An outer wrapper rejecting incomplete squads must not hide a permissive helper.
do $$
declare
  current_week uuid := md5('schema-upgrade-new-week')::uuid;
  original_lock timestamptz;
  valid_squad jsonb;
  draft jsonb;
  function_name text;
  before_save jsonb;
begin
  select lock_at into original_lock from public.fantasy_gameweeks where id = current_week;
  update public.fantasy_gameweeks set lock_at = now() + interval '30 minutes' where id = current_week;
  perform set_config('request.jwt.claim.sub', md5('schema-upgrade-user-1')::uuid::text, true);
  select jsonb_agg(jsonb_build_object('player_id', player_id, 'position', position,
      'is_captain', is_captain) order by lineup_order)
    into valid_squad from public.fantasy_team_players
    where fantasy_team_id = md5('schema-upgrade-team-1')::uuid;
  before_save := pg_temp.data_state();

  if has_function_privilege('anon',
      'public.save_my_fantasy_team_without_lineup_order(uuid,jsonb,text)', 'execute')
    or has_function_privilege('authenticated',
      'public.save_my_fantasy_team_without_lineup_order(uuid,jsonb,text)', 'execute') then
    raise exception 'Ordinary API users can bypass the public save wrapper';
  end if;

  foreach function_name in array array[
    'save_my_complete_fantasy_team', 'save_my_fantasy_team_without_lineup_order'
  ] loop
    foreach draft in array array[
      '[]'::jsonb, valid_squad - 5, valid_squad - 5 - 4,
      jsonb_set(valid_squad, '{3,position}', '"bench"'),
      jsonb_set(valid_squad, '{4,position}', '"starter"'),
      valid_squad || (valid_squad -> 0)
    ] loop
      begin
        execute format('select public.%I($1, $2, $3)', function_name)
          using current_week, draft, 'wildcard'::text;
        raise exception 'Invalid squad was accepted by %', function_name;
      exception when raise_exception then
        if sqlerrm !~ '(exactly six|exactly four|four main)' then raise; end if;
      end;
      if pg_temp.data_state() is distinct from before_save then
        raise exception 'Rejected save changed squads, chips, budgets or history';
      end if;
    end loop;

    -- A valid 4+2 squad must still save successfully through either layer.
    -- Roll it back after execution, including its normal row timestamps.
    begin
      execute format('select public.%I($1, $2, $3)', function_name)
        using current_week, valid_squad, 'wildcard'::text;
      raise exception using errcode = 'P9999', message = 'Roll back successful fixture save';
    exception when sqlstate 'P9999' then
      null;
    end;
    if pg_temp.data_state() is distinct from before_save then
      raise exception 'Successful-save regression left fixture changes behind';
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
  update public.fantasy_gameweeks set lock_at = original_lock where id = current_week;
end;
$$;

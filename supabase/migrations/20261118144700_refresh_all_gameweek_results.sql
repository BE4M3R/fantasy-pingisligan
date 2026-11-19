begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Historical protection freezes fixture membership, not results. Every round
-- must still import upstream results and score against its saved selections.
-- Existing stage locks and completion markers remain in force.
create or replace function public.update_gameweek_result_matches(p_matches jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare stage integer; incoming jsonb; m public.matches;
begin
  for stage in select distinct stored.stupa_stage_id from public.matches stored
    join jsonb_array_elements(p_matches) x on stored.id = (x->>'id')::uuid order by 1 loop
    perform private.gameweek_stage_lock(stage);
  end loop;
  for incoming in select value from jsonb_array_elements(p_matches) loop
    select * into m from public.matches where id = (incoming->>'id')::uuid;
    if row(m.status,m.winning_team_stupa_participant_id,m.home_team_stupa_participant_id,m.away_team_stupa_participant_id)
      is not distinct from row(incoming->>'status',(incoming->>'winning_team_stupa_participant_id')::integer,
        (incoming->>'home_team_stupa_participant_id')::integer,(incoming->>'away_team_stupa_participant_id')::integer) then continue; end if;
    update public.matches set status = incoming->>'status', winning_team_stupa_participant_id = (incoming->>'winning_team_stupa_participant_id')::integer,
      home_team_stupa_participant_id = (incoming->>'home_team_stupa_participant_id')::integer,
      away_team_stupa_participant_id = (incoming->>'away_team_stupa_participant_id')::integer,
      source_updated_at = (incoming->>'source_updated_at')::timestamptz where id = m.id;
    insert into private.gameweek_rescore_queue(gameweek_id) select m.fantasy_gameweek_id where m.fantasy_gameweek_id is not null
      on conflict(gameweek_id) do update set requested_at = excluded.requested_at;
  end loop;
end;
$$;

create or replace function public.calculate_fantasy_gameweek_points(target_gameweek_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare stage integer; scored integer;
begin
  select stupa_stage_id into stage from public.fantasy_gameweeks where id = target_gameweek_id;
  perform private.gameweek_stage_lock(stage);
  scored := public.calculate_fantasy_gameweek_points_before_buckets(target_gameweek_id);
  delete from private.gameweek_rescore_queue where gameweek_id = target_gameweek_id;
  return scored;
end;
$$;

create or replace function public.score_gameweek_refresh(p_stage_id integer, p_gameweek_ids uuid[] default '{}')
returns integer language plpgsql security definer set search_path = '' as $$
declare week uuid; stage integer; total integer := 0;
begin
  for stage in select p_stage_id union select g.stupa_stage_id from public.fantasy_gameweeks g where g.id = any(p_gameweek_ids) order by 1 loop
    perform private.gameweek_stage_lock(stage);
  end loop;
  for week in select g.id from public.fantasy_gameweeks g where (g.id = any(p_gameweek_ids) or (g.stupa_stage_id = p_stage_id and exists(select 1 from private.gameweek_rescore_queue q where q.gameweek_id = g.id))) order by g.round_order, g.id loop
    perform public.calculate_fantasy_gameweek_points(week); total := total + 1;
  end loop;
  return total;
end;
$$;

create or replace function public.complete_gameweek_refresh(p_gameweek_id uuid, p_refreshed_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare g public.fantasy_gameweeks;
begin
  select * into g from public.fantasy_gameweeks where id = p_gameweek_id;
  perform private.gameweek_stage_lock(g.stupa_stage_id);
  select * into g from public.fantasy_gameweeks where id = p_gameweek_id for update;
  if g.data_refreshed_at is not null then return false; end if;
  if g.schedule_updated_at > p_refreshed_at or exists(select 1 from private.gameweek_rescore_queue where gameweek_id = g.id) then
    raise exception 'Gameweek schedule changed or scoring is pending; retry results refresh';
  end if;
  -- Require real legacy fixtures to finish too, while preserving synthetic
  -- time controls for uninitialized test stages.
  if (g.bucket_initialized_at is not null or private.gameweek_history_protected(g.id)) and exists(select 1 from public.matches m where m.fantasy_gameweek_id = g.id
    and lower(m.status) not in ('scored','cancelled','canceled','deleted')
    and not (lower(m.status) = 'postponed' and m.starts_at is null)) then
    raise exception 'Required gameweek fixture results have not all been processed';
  end if;
  return public.complete_gameweek_refresh_before_buckets(p_gameweek_id,p_refreshed_at);
end;
$$;

create or replace function public.persist_stupa_results(p_submatches jsonb, p_player_results jsonb, p_retracted_submatches jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare stage integer; result jsonb;
begin
  for stage in select distinct m.stupa_stage_id from public.matches m join (
      select value from jsonb_array_elements(p_submatches) union all select value from jsonb_array_elements(p_retracted_submatches)
    ) x on m.id = (x.value->>'match_id')::uuid order by 1 loop
    perform private.gameweek_stage_lock(stage);
  end loop;
  result := public.persist_stupa_results_before_buckets(p_submatches,p_player_results,p_retracted_submatches);
  insert into private.gameweek_rescore_queue(gameweek_id)
    select distinct m.fantasy_gameweek_id from public.matches m
      join jsonb_array_elements(p_submatches) x on m.id = (x.value->>'match_id')::uuid where m.fantasy_gameweek_id is not null
    union select value::uuid from jsonb_array_elements_text(result->'retracted_gameweek_ids')
    on conflict(gameweek_id) do update set requested_at = excluded.requested_at;
  return result;
end;
$$;

create or replace view public.gameweeks_ready_for_refresh as
select g.* from public.fantasy_gameweeks g
where g.data_refreshed_at is null
  and not exists(select 1 from private.gameweek_rescore_queue q where q.gameweek_id = g.id)
  and ((g.bucket_initialized_at is null and not private.gameweek_history_protected(g.id)) or not exists(select 1 from public.matches m where m.fantasy_gameweek_id = g.id
    and lower(m.status) not in ('scored','cancelled','canceled','deleted')
    and not (lower(m.status) = 'postponed' and m.starts_at is null)));

commit;

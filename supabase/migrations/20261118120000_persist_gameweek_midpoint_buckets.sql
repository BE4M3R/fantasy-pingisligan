begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.fantasy_gameweeks
  add column bucket_starts_at timestamptz,
  add column bucket_ends_at timestamptz,
  add column anchor_week date,
  add column anchor_at timestamptz,
  add column bucket_initialized_at timestamptz,
  add column schedule_updated_at timestamptz,
  add constraint positive_gameweek_bucket check (bucket_starts_at is null or bucket_ends_at is null or bucket_starts_at < bucket_ends_at);

create table private.gameweek_bucket_policies (
  stage_id integer primary key,
  first_round integer not null,
  cutover_at timestamptz,
  version integer not null default 1 check (version = 1),
  initialized_at timestamptz not null default now()
);
create table private.gameweek_rescore_queue (
  gameweek_id uuid primary key references public.fantasy_gameweeks(id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp()
);
revoke all on private.gameweek_bucket_policies, private.gameweek_rescore_queue from public, anon, authenticated, service_role;

create function private.gameweek_stage_lock(stage_id integer)
returns void language sql security definer set search_path = '' as $$
  select pg_advisory_xact_lock(571827, stage_id);
$$;
revoke all on function private.gameweek_stage_lock(integer) from public, anon, authenticated, service_role;

create function private.gameweek_history_protected(gameweek_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fantasy_gameweeks g
    where g.id = gameweek_id and g.stupa_stage_id = 5727 and g.round_order < 6);
$$;
revoke all on function private.gameweek_history_protected(uuid) from public, anon, authenticated, service_role;
-- Views check function EXECUTE as their caller even when underlying table
-- access uses the view owner. This read-only predicate is needed by the job's
-- readiness projection; private tables and mutations stay inaccessible.
grant execute on function private.gameweek_history_protected(uuid) to service_role;

create function private.validate_gameweek_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source_week public.fantasy_gameweeks; destination_week public.fantasy_gameweeks;
begin
  if tg_op = 'UPDATE' and new.fantasy_gameweek_id is not distinct from old.fantasy_gameweek_id then return new; end if;
  if tg_op = 'UPDATE' then select * into source_week from public.fantasy_gameweeks where id = old.fantasy_gameweek_id; end if;
  select * into destination_week from public.fantasy_gameweeks where id = new.fantasy_gameweek_id;
  if (source_week.id is not null and (source_week.data_refreshed_at is not null or private.gameweek_history_protected(source_week.id)))
    or (destination_week.id is not null and (destination_week.data_refreshed_at is not null or private.gameweek_history_protected(destination_week.id))) then
    -- Historic first-time imports may create missing parent records, but may
    -- never add fixtures to a finished historical round or move existing ones.
    if tg_op = 'INSERT' and destination_week.data_refreshed_at is null and destination_week.bucket_initialized_at is null then return new; end if;
    raise exception 'Protected fixture reassignment requires manual resolution'
      using detail = jsonb_build_object('fixture', new.stupa_match_id, 'clubs', jsonb_build_array(new.home_team_name, new.away_team_name),
        'source', source_week.name, 'destination', destination_week.name,
        'source_finished', source_week.data_refreshed_at is not null, 'destination_finished', destination_week.data_refreshed_at is not null,
        'previous_kickoff', case when tg_op = 'UPDATE' then old.starts_at else null end, 'new_kickoff', new.starts_at)::text;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_gameweek_membership() from public, anon, authenticated, service_role;
create trigger protect_finished_gameweek_membership before insert or update of fantasy_gameweek_id on public.matches
for each row execute function private.validate_gameweek_membership();

create function public.persist_gameweek_schedule(p_stage_id integer, p_gameweeks jsonb, p_matches jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  policy private.gameweek_bucket_policies;
  gw jsonb; fixture jsonb; proposed public.fantasy_gameweeks; existing public.fantasy_gameweeks;
  original public.matches; target public.fantasy_gameweeks;
  first_round integer; next_start timestamptz; first_period boolean := true;
  home_id uuid; away_id uuid; club_name text; club_id uuid;
  kickoff timestamptz; finish timestamptz; first_start timestamptz; last_end timestamptz;
  moves jsonb := '[]'; imported integer := 0; changed boolean; initialized boolean; refresh_time timestamptz := clock_timestamp();
begin
  perform private.gameweek_stage_lock(p_stage_id);
  if jsonb_typeof(p_gameweeks) <> 'array' or jsonb_array_length(p_gameweeks) = 0 or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'A complete validated stage schedule is required';
  end if;
  select * into policy from private.gameweek_bucket_policies where stage_id = p_stage_id;
  initialized := policy.stage_id is not null;
  if policy.stage_id is null then
    select case when p_stage_id = 5727 then 6 else min((g->>'round_order')::integer) end into first_round from jsonb_array_elements(p_gameweeks) g;
    for gw in select value from jsonb_array_elements(p_gameweeks) order by (value->>'round_order')::integer loop
      if (gw->>'round_order')::integer < first_round then continue; end if;
      if not first_period and (gw->>'bucket_starts_at')::timestamptz is distinct from next_start then
        raise exception 'Bucket periods have gaps, overlaps or unexpected unbounded edges' using detail = p_gameweeks::text;
      end if;
      if gw->>'anchor_week' is null or gw->>'anchor_at' is null or
        (gw->>'bucket_starts_at' is not null and gw->>'bucket_ends_at' is not null and
          (gw->>'bucket_starts_at')::timestamptz >= (gw->>'bucket_ends_at')::timestamptz) then
        raise exception 'Invalid gameweek period or anchor' using detail = gw::text;
      end if;
      if first_period then
        insert into private.gameweek_bucket_policies(stage_id, first_round, cutover_at)
        values(p_stage_id, first_round, (gw->>'bucket_starts_at')::timestamptz) returning * into policy;
      end if;
      next_start := (gw->>'bucket_ends_at')::timestamptz; first_period := false;
    end loop;
    if first_period or next_start is not null then raise exception 'Stage must have a final unbounded period'; end if;
  end if;

  for gw in select value from jsonb_array_elements(p_gameweeks) order by (value->>'round_order')::integer loop
    select * into existing from public.fantasy_gameweeks where stupa_round_id = (gw->>'stupa_round_id')::integer for update;
    if initialized and (existing.id is null or (existing.round_order >= policy.first_round and existing.bucket_initialized_at is null)) then
      raise exception 'Unexpected round requires an explicit validated amendment' using detail = gw::text;
    end if;
    if existing.id is not null and existing.stupa_stage_id <> p_stage_id then raise exception 'STUPA round belongs to a different stage'; end if;
    if existing.bucket_initialized_at is not null then
      if existing.round_order <> (gw->>'round_order')::integer or existing.bucket_starts_at is distinct from (gw->>'bucket_starts_at')::timestamptz
        or existing.bucket_ends_at is distinct from (gw->>'bucket_ends_at')::timestamptz
        or existing.anchor_at is distinct from (gw->>'anchor_at')::timestamptz or existing.anchor_week is distinct from (gw->>'anchor_week')::date then
        raise exception 'Initialized bucket amendment requires explicit manual resolution' using detail = gw::text;
      end if;
      continue;
    end if;
    if existing.data_refreshed_at is not null and (gw->>'round_order')::integer >= policy.first_round then
      raise exception 'Cannot initialize a finished gameweek' using detail = gw::text;
    end if;
    select min((m->>'starts_at')::timestamptz), max((m->>'ends_at')::timestamptz) into first_start, last_end
      from jsonb_array_elements(p_matches) m where (m->>'stupa_round_id')::integer = (gw->>'stupa_round_id')::integer;
    if first_start is null or last_end is null then raise exception 'Initial gameweek requires a valid planned lifecycle' using detail = gw::text; end if;
    insert into public.fantasy_gameweeks(stupa_stage_id, stupa_round_id, name, round_order,
      first_match_starts_at, last_match_ends_at, lock_at, unlock_at,
      bucket_starts_at, bucket_ends_at, anchor_week, anchor_at, bucket_initialized_at)
    values(p_stage_id, (gw->>'stupa_round_id')::integer, gw->>'name', (gw->>'round_order')::integer,
      first_start, last_end, first_start - interval '2 hours',
      (((last_end at time zone 'Europe/Stockholm')::date + 1)::timestamp at time zone 'Europe/Stockholm'),
      case when (gw->>'round_order')::integer >= policy.first_round then (gw->>'bucket_starts_at')::timestamptz end,
      case when (gw->>'round_order')::integer >= policy.first_round then (gw->>'bucket_ends_at')::timestamptz end,
      case when (gw->>'round_order')::integer >= policy.first_round then (gw->>'anchor_week')::date end,
      case when (gw->>'round_order')::integer >= policy.first_round then (gw->>'anchor_at')::timestamptz end,
      case when (gw->>'round_order')::integer >= policy.first_round then refresh_time end)
    on conflict(stupa_round_id) do update set bucket_starts_at = excluded.bucket_starts_at, bucket_ends_at = excluded.bucket_ends_at,
      anchor_week = excluded.anchor_week, anchor_at = excluded.anchor_at, bucket_initialized_at = excluded.bucket_initialized_at;
  end loop;

  for fixture in select value from jsonb_array_elements(p_matches) order by (value->>'stupa_match_id')::integer loop
    kickoff := (fixture->>'starts_at')::timestamptz; finish := (fixture->>'ends_at')::timestamptz;
    select * into original from public.matches where stupa_match_id = (fixture->>'stupa_match_id')::integer for update;
    if original.id is not null and original.stupa_stage_id <> p_stage_id then raise exception 'Fixture belongs to another stage'; end if;
    if kickoff is null then
      select * into target from public.fantasy_gameweeks where id = original.fantasy_gameweek_id;
      if target.id is null then raise exception 'Undated fixture without an existing assignment requires manual resolution' using detail = fixture::text; end if;
    else
      select * into target from public.fantasy_gameweeks where stupa_stage_id = p_stage_id and bucket_initialized_at is not null
        and (bucket_starts_at is null or kickoff >= bucket_starts_at) and (bucket_ends_at is null or kickoff < bucket_ends_at);
      if target.id is null then
        if p_stage_id <> 5727 or (fixture->>'round_order')::integer >= 6 then
          raise exception 'Fixture crosses the historical cutover' using detail = fixture::text;
        end if;
        select * into target from public.fantasy_gameweeks where stupa_stage_id = p_stage_id and stupa_round_id = (fixture->>'stupa_round_id')::integer;
      end if;
    end if;
    if original.id is not null and private.gameweek_history_protected(original.fantasy_gameweek_id) then
      if target.id is distinct from original.fantasy_gameweek_id then raise exception 'Fixture crosses historical protection' using detail = fixture::text; end if;
      continue;
    end if;
    if original.id is not null and original.fantasy_gameweek_id is distinct from target.id then
      moves := moves || jsonb_build_array(jsonb_build_object('fixture', original.stupa_match_id, 'source', original.fantasy_gameweek_id, 'destination', target.id));
      insert into private.gameweek_rescore_queue(gameweek_id) select original.fantasy_gameweek_id where original.fantasy_gameweek_id is not null
        on conflict(gameweek_id) do update set requested_at = excluded.requested_at;
    end if;
    home_id := null; away_id := null;
    for club_name in select fixture->>'home_team_name' union select fixture->>'away_team_name' loop
      if club_name is null then continue; end if;
      club_id := case when club_name = fixture->>'home_team_name' then (fixture->>'home_club_id')::uuid else (fixture->>'away_club_id')::uuid end;
      if club_id is not null then
        update public.clubs set name = club_name where id = club_id returning id into club_id;
        if club_id is null then raise exception 'Unknown club identity'; end if;
      else
        insert into public.clubs(name) values(club_name) on conflict(name) do update set name = excluded.name returning id into club_id;
      end if;
      if club_name = fixture->>'home_team_name' then home_id := club_id; end if;
      if club_name = fixture->>'away_team_name' then away_id := club_id; end if;
    end loop;
    changed := original.id is null or row(original.fantasy_gameweek_id, original.starts_at, original.ends_at, original.status,
      original.home_club_id, original.away_club_id, original.winning_team_stupa_participant_id)
      is distinct from row(target.id, kickoff, finish, fixture->>'status', home_id, away_id, (fixture->>'winning_team_stupa_participant_id')::integer);
    insert into public.matches(stupa_match_id, profixio_id, fantasy_gameweek_id, stupa_stage_id, stupa_round_id, stupa_event_match_id, stupa_group_id,
      home_club_id, away_club_id, home_team_name, away_team_name, home_team_stupa_participant_id, away_team_stupa_participant_id,
      winning_team_stupa_participant_id, starts_at, ends_at, status, source_updated_at)
    values((fixture->>'stupa_match_id')::integer, fixture->>'profixio_id', target.id, p_stage_id, (fixture->>'stupa_round_id')::integer,
      (fixture->>'stupa_event_match_id')::integer, (fixture->>'stupa_group_id')::integer, home_id, away_id,
      fixture->>'home_team_name', fixture->>'away_team_name', (fixture->>'home_team_stupa_participant_id')::integer,
      (fixture->>'away_team_stupa_participant_id')::integer, (fixture->>'winning_team_stupa_participant_id')::integer,
      kickoff, finish, fixture->>'status', refresh_time)
    on conflict(stupa_match_id) do update set fantasy_gameweek_id = excluded.fantasy_gameweek_id,
      stupa_round_id = excluded.stupa_round_id, stupa_event_match_id = excluded.stupa_event_match_id, stupa_group_id = excluded.stupa_group_id,
      home_club_id = excluded.home_club_id, away_club_id = excluded.away_club_id, home_team_name = excluded.home_team_name, away_team_name = excluded.away_team_name,
      home_team_stupa_participant_id = excluded.home_team_stupa_participant_id, away_team_stupa_participant_id = excluded.away_team_stupa_participant_id,
      winning_team_stupa_participant_id = excluded.winning_team_stupa_participant_id,
      starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status, source_updated_at = excluded.source_updated_at;
    if changed then
      insert into private.gameweek_rescore_queue(gameweek_id) values(target.id) on conflict(gameweek_id) do update set requested_at = excluded.requested_at;
      update public.fantasy_gameweeks set schedule_updated_at = refresh_time where id = target.id or id = original.fantasy_gameweek_id;
    end if;
    imported := imported + 1;
  end loop;
  for existing in select * from public.fantasy_gameweeks where stupa_stage_id = p_stage_id
    and bucket_initialized_at is not null and data_refreshed_at is null order by round_order loop
    select min(starts_at), max(ends_at) into first_start, last_end from public.matches where fantasy_gameweek_id = existing.id
      and lower(status) not in ('cancelled', 'canceled', 'deleted') and not (lower(status) = 'postponed' and starts_at is null);
    if first_start is null or last_end is null then
      raise warning 'Gameweek % has no dated required fixtures; retaining its last planned lifecycle', existing.name;
      continue;
    end if;
    update public.fantasy_gameweeks set first_match_starts_at = first_start, last_match_ends_at = last_end,
      lock_at = case when existing.lock_at <= refresh_time then existing.lock_at else first_start - interval '2 hours' end,
      unlock_at = (((last_end at time zone 'Europe/Stockholm')::date + 1)::timestamp at time zone 'Europe/Stockholm'),
      imported_at = refresh_time, updated_at = refresh_time where id = existing.id;
  end loop;
  return jsonb_build_object('imported_matches', imported, 'moves', moves);
end;
$$;
revoke all on function public.persist_gameweek_schedule(integer,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.persist_gameweek_schedule(integer,jsonb,jsonb) to service_role;

-- Serialize result writes with schedule changes before any parent row is locked.
create function public.update_gameweek_result_matches(p_matches jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare stage integer; incoming jsonb; m public.matches;
begin
  for stage in select distinct stored.stupa_stage_id from public.matches stored
    join jsonb_array_elements(p_matches) x on stored.id = (x->>'id')::uuid order by 1 loop
    perform private.gameweek_stage_lock(stage);
  end loop;
  for incoming in select value from jsonb_array_elements(p_matches) loop
    select * into m from public.matches where id = (incoming->>'id')::uuid;
    if private.gameweek_history_protected(m.fantasy_gameweek_id) then continue; end if;
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
revoke all on function public.update_gameweek_result_matches(jsonb) from public, anon, authenticated;
grant execute on function public.update_gameweek_result_matches(jsonb) to service_role;

alter function public.calculate_fantasy_gameweek_points(uuid) rename to calculate_fantasy_gameweek_points_before_buckets;
revoke all on function public.calculate_fantasy_gameweek_points_before_buckets(uuid) from public, anon, authenticated, service_role;
create function public.calculate_fantasy_gameweek_points(target_gameweek_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare stage integer; scored integer;
begin
  select stupa_stage_id into stage from public.fantasy_gameweeks where id = target_gameweek_id;
  perform private.gameweek_stage_lock(stage);
  if private.gameweek_history_protected(target_gameweek_id) then return 0; end if;
  scored := public.calculate_fantasy_gameweek_points_before_buckets(target_gameweek_id);
  delete from private.gameweek_rescore_queue where gameweek_id = target_gameweek_id;
  return scored;
end;
$$;
revoke all on function public.calculate_fantasy_gameweek_points(uuid) from public, anon, authenticated;
grant execute on function public.calculate_fantasy_gameweek_points(uuid) to service_role;

create function public.score_gameweek_refresh(p_stage_id integer, p_gameweek_ids uuid[] default '{}')
returns integer language plpgsql security definer set search_path = '' as $$
declare week uuid; stage integer; total integer := 0;
begin
  for stage in select p_stage_id union select g.stupa_stage_id from public.fantasy_gameweeks g where g.id = any(p_gameweek_ids) order by 1 loop
    perform private.gameweek_stage_lock(stage);
  end loop;
  for week in select g.id from public.fantasy_gameweeks g where not private.gameweek_history_protected(g.id)
    and (g.id = any(p_gameweek_ids) or (g.stupa_stage_id = p_stage_id and exists(select 1 from private.gameweek_rescore_queue q where q.gameweek_id = g.id))) order by g.round_order, g.id loop
    perform public.calculate_fantasy_gameweek_points(week); total := total + 1;
  end loop;
  return total;
end;
$$;
revoke all on function public.score_gameweek_refresh(integer,uuid[]) from public, anon, authenticated;
grant execute on function public.score_gameweek_refresh(integer,uuid[]) to service_role;

alter function public.complete_gameweek_refresh(uuid,timestamptz) rename to complete_gameweek_refresh_before_buckets;
revoke all on function public.complete_gameweek_refresh_before_buckets(uuid,timestamptz) from public, anon, authenticated, service_role;
create function public.complete_gameweek_refresh(p_gameweek_id uuid, p_refreshed_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare g public.fantasy_gameweeks;
begin
  select * into g from public.fantasy_gameweeks where id = p_gameweek_id;
  perform private.gameweek_stage_lock(g.stupa_stage_id);
  select * into g from public.fantasy_gameweeks where id = p_gameweek_id for update;
  if private.gameweek_history_protected(g.id) then raise exception 'Historical gameweek completion is protected'; end if;
  if g.data_refreshed_at is not null then return false; end if;
  if g.schedule_updated_at > p_refreshed_at or exists(select 1 from private.gameweek_rescore_queue where gameweek_id = g.id) then
    raise exception 'Gameweek schedule changed or scoring is pending; retry results refresh';
  end if;
  -- Preserve legacy synthetic time controls. Initialized periods use the new
  -- explicit readiness policy, including postponed/empty/cancelled cases.
  if g.bucket_initialized_at is not null and exists(select 1 from public.matches m where m.fantasy_gameweek_id = g.id
    and lower(m.status) not in ('scored','cancelled','canceled','deleted')
    and not (lower(m.status) = 'postponed' and m.starts_at is null)) then
    raise exception 'Required gameweek fixture results have not all been processed';
  end if;
  return public.complete_gameweek_refresh_before_buckets(p_gameweek_id,p_refreshed_at);
end;
$$;
revoke all on function public.complete_gameweek_refresh(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.complete_gameweek_refresh(uuid,timestamptz) to service_role;

-- A delayed older week must not prevent a later ready week completing. Only
-- the job role can read this narrow readiness view; completion rechecks under
-- the same stage lock, so the view is a candidate lookup rather than authority.
create view public.gameweeks_ready_for_refresh as
select g.* from public.fantasy_gameweeks g
where g.data_refreshed_at is null and not private.gameweek_history_protected(g.id)
  and not exists(select 1 from private.gameweek_rescore_queue q where q.gameweek_id = g.id)
  and (g.bucket_initialized_at is null or not exists(select 1 from public.matches m where m.fantasy_gameweek_id = g.id
    and lower(m.status) not in ('scored','cancelled','canceled','deleted')
    and not (lower(m.status) = 'postponed' and m.starts_at is null)));
revoke all on public.gameweeks_ready_for_refresh from public, anon, authenticated;
grant select on public.gameweeks_ready_for_refresh to service_role;


-- Retain the existing reconciliation implementation and its positional-ID
-- safeguards; the wrapper filters protected history and takes stage locks first.
alter function public.persist_stupa_results(jsonb,jsonb,jsonb) rename to persist_stupa_results_before_buckets;
revoke all on function public.persist_stupa_results_before_buckets(jsonb,jsonb,jsonb) from public, anon, authenticated, service_role;
create function public.persist_stupa_results(p_submatches jsonb, p_player_results jsonb, p_retracted_submatches jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare stage integer; incoming jsonb; retracted jsonb; players jsonb; result jsonb;
begin
  for stage in select distinct m.stupa_stage_id from public.matches m join (
      select value from jsonb_array_elements(p_submatches) union all select value from jsonb_array_elements(p_retracted_submatches)
    ) x on m.id = (x.value->>'match_id')::uuid order by 1 loop
    perform private.gameweek_stage_lock(stage);
  end loop;
  select coalesce(jsonb_agg(x), '[]') into incoming from jsonb_array_elements(p_submatches) x
    where not exists(select 1 from public.matches m where m.id = (x->>'match_id')::uuid and private.gameweek_history_protected(m.fantasy_gameweek_id));
  select coalesce(jsonb_agg(x), '[]') into retracted from jsonb_array_elements(p_retracted_submatches) x
    where not exists(select 1 from public.matches m where m.id = (x->>'match_id')::uuid and private.gameweek_history_protected(m.fantasy_gameweek_id));
  select coalesce(jsonb_agg(x), '[]') into players from jsonb_array_elements(p_player_results) x
    where not exists(select 1 from jsonb_array_elements(p_submatches) y join public.matches m on m.id = (y->>'match_id')::uuid
      where y->>'stupa_submatch_id' = x->>'stupa_submatch_id' and private.gameweek_history_protected(m.fantasy_gameweek_id));
  result := public.persist_stupa_results_before_buckets(incoming,players,retracted);
  insert into private.gameweek_rescore_queue(gameweek_id)
    select distinct m.fantasy_gameweek_id from public.matches m
      join jsonb_array_elements(incoming) x on m.id = (x.value->>'match_id')::uuid where m.fantasy_gameweek_id is not null
    union select value::uuid from jsonb_array_elements_text(result->'retracted_gameweek_ids')
    on conflict(gameweek_id) do update set requested_at = excluded.requested_at;
  return result;
end;
$$;
revoke all on function public.persist_stupa_results(jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.persist_stupa_results(jsonb,jsonb,jsonb) to service_role;

-- A golden doubles match is played after the regular fixture even though its
-- STUPA order restarts at one. Only the winner of the actual final scored
-- submatch can earn the fixture clincher bonus.
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
      submatches.match_order,
      submatches.is_golden_match,
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
      and lower(matches.status) not in ('cancelled', 'canceled', 'deleted')
    group by submatches.stupa_submatch_id, submatches.match_id,
      submatches.match_order, submatches.is_golden_match
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
        when context.is_doubles then case when results.won then 2 else 0 end
        when context.is_walkover then case when results.won then 7 else 0 end
        else
          (case when results.won then 4 else 0 end)
          + case
              when results.won then greatest(results.sets_won - results.sets_lost, 0)
              else results.sets_won
            end
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
  final_submatches as (
    select distinct on (context.match_id)
      context.match_id,
      context.stupa_submatch_id,
      context.is_doubles
    from submatch_context as context
    order by context.match_id, context.is_golden_match desc,
      context.match_order desc nulls last, context.stupa_submatch_id desc
  ),
  clinching_bonus as (
    select
      final_submatches.match_id,
      results.player_id,
      case when final_submatches.is_doubles then 1 else 2 end as points
    from final_submatches
    join public.matches
      on matches.id = final_submatches.match_id
    join public.player_submatch_results as results
      on results.stupa_submatch_id = final_submatches.stupa_submatch_id
    where lower(matches.status) = 'scored'
      and results.won
      and results.team_stupa_participant_id = matches.winning_team_stupa_participant_id
      and results.player_id is not null
  ),
  gameweek_roster as (
    select
      roster.player_id,
      roster.club_id_at_lock
    from public.player_gameweek_club_snapshots as roster
    where roster.fantasy_gameweek_id = target_gameweek_id
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
    result_totals.match_id,
    result_totals.player_id,
    result_totals.won_matches,
    result_totals.lost_matches,
    result_totals.won_sets,
    result_totals.lost_sets,
    result_totals.points
      + case
          when winning_clubs.club_id = gameweek_roster.club_id_at_lock then 3
          else 0
        end
      + case
          when singles_bonus.bonus_match_id = result_totals.match_id then 2
          else 0
        end
      + coalesce(clinching_bonus.points, 0)
  from result_totals
  left join winning_clubs on winning_clubs.match_id = result_totals.match_id
  left join gameweek_roster on gameweek_roster.player_id = result_totals.player_id
  left join singles_bonus on singles_bonus.player_id = result_totals.player_id
  left join clinching_bonus
    on clinching_bonus.match_id = result_totals.match_id
    and clinching_bonus.player_id = result_totals.player_id;

  get diagnostics inserted_stat_count = row_count;
  return inserted_stat_count;
end;
$$;


create or replace function public.get_my_squad_score_breakdown(target_gameweek_id uuid)
returns table (
  player_id uuid,
  singles_sets_won integer,
  singles_sets_lost integer,
  singles_set_points integer,
  fixture_win_points integer,
  clinching_bonus_points integer
)
language sql
security definer
set search_path = ''
stable
as $$
  with selected_snapshot as (
    select
      snapshots.fantasy_team_id,
      snapshots.fantasy_gameweek_id
    from public.fantasy_team_gameweek_snapshots as snapshots
    join public.fantasy_teams as teams
      on teams.id = snapshots.fantasy_team_id
      and teams.user_id = auth.uid()
    where snapshots.fantasy_gameweek_id = target_gameweek_id
  ),
  side_sizes as (
    select
      results.stupa_submatch_id,
      results.team_stupa_participant_id,
      count(*)::integer as player_count
    from public.player_submatch_results as results
    join public.stupa_submatches as submatches
      on submatches.stupa_submatch_id = results.stupa_submatch_id
    join public.matches as matches
      on matches.id = submatches.match_id
    join selected_snapshot
      on selected_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
    group by results.stupa_submatch_id, results.team_stupa_participant_id
  ),
  submatch_context as (
    select
      submatches.stupa_submatch_id,
      submatches.match_id,
      submatches.match_order,
      submatches.is_golden_match,
      bool_or(side_sizes.player_count > 1) as is_doubles,
      bool_or(
        results.walkover
        or nullif(results.raw_payload #>> '{side,walkover_reason}', '') is not null
      ) as is_walkover
    from public.stupa_submatches as submatches
    join public.matches as matches
      on matches.id = submatches.match_id
    join selected_snapshot
      on selected_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
    join public.player_submatch_results as results
      on results.stupa_submatch_id = submatches.stupa_submatch_id
    join side_sizes
      on side_sizes.stupa_submatch_id = results.stupa_submatch_id
      and side_sizes.team_stupa_participant_id = results.team_stupa_participant_id
    where upper(submatches.status) = 'SCORED'
      and lower(matches.status) not in ('cancelled', 'canceled', 'deleted')
    group by submatches.stupa_submatch_id, submatches.match_id,
      submatches.match_order, submatches.is_golden_match
  ),
  result_components as (
    select
      context.match_id,
      context.stupa_submatch_id,
      context.match_order,
      context.is_doubles,
      context.is_walkover,
      results.player_id,
      results.team_stupa_participant_id,
      results.won,
      case
        when context.is_walkover and results.won then 3
        when context.is_walkover then 0
        else results.sets_won
      end as sets_won,
      case when context.is_walkover then 0 else results.sets_lost end as sets_lost,
      case
        when context.is_doubles then 0
        when context.is_walkover then case when results.won then 3 else 0 end
        when results.won then greatest(results.sets_won - results.sets_lost, 0)
        else results.sets_won
      end as set_points
    from submatch_context as context
    join public.player_submatch_results as results
      on results.stupa_submatch_id = context.stupa_submatch_id
    where results.player_id is not null
  ),
  result_totals as (
    select
      player_id,
      coalesce(sum(sets_won) filter (where not is_doubles), 0)::integer as singles_sets_won,
      coalesce(sum(sets_lost) filter (where not is_doubles), 0)::integer as singles_sets_lost,
      coalesce(sum(set_points), 0)::integer as singles_set_points
    from result_components
    group by player_id
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
    from public.matches as matches
    join selected_snapshot
      on selected_snapshot.fantasy_gameweek_id = matches.fantasy_gameweek_id
  ),
  fixture_participants as (
    select distinct match_id, player_id
    from result_components
  ),
  fixture_bonuses as (
    select
      fixture_participants.player_id,
      (count(*) * 3)::integer as fixture_win_points
    from fixture_participants
    join winning_clubs
      on winning_clubs.match_id = fixture_participants.match_id
    join public.player_gameweek_club_snapshots as roster
      on roster.fantasy_gameweek_id = target_gameweek_id
      and roster.player_id = fixture_participants.player_id
      and roster.club_id_at_lock = winning_clubs.club_id
    group by fixture_participants.player_id
  ),
  final_submatches as (
    select distinct on (context.match_id)
      context.match_id,
      context.stupa_submatch_id,
      context.is_doubles
    from submatch_context as context
    order by context.match_id, context.is_golden_match desc,
      context.match_order desc nulls last, context.stupa_submatch_id desc
  ),
  clinching_bonuses as (
    select
      final_submatches.match_id,
      result_components.player_id,
      case when final_submatches.is_doubles then 1 else 2 end as points
    from final_submatches
    join public.matches as matches
      on matches.id = final_submatches.match_id
    join result_components
      on result_components.stupa_submatch_id = final_submatches.stupa_submatch_id
    where lower(matches.status) = 'scored'
      and result_components.won
      and result_components.team_stupa_participant_id =
        matches.winning_team_stupa_participant_id
  ),
  clinching_totals as (
    select player_id, sum(points)::integer as clinching_bonus_points
    from clinching_bonuses
    group by player_id
  )
  select
    snapshot_players.player_id,
    coalesce(result_totals.singles_sets_won, 0)::integer,
    coalesce(result_totals.singles_sets_lost, 0)::integer,
    coalesce(result_totals.singles_set_points, 0)::integer,
    coalesce(fixture_bonuses.fixture_win_points, 0)::integer,
    coalesce(clinching_totals.clinching_bonus_points, 0)::integer
  from selected_snapshot
  join public.fantasy_team_gameweek_players as snapshot_players
    on snapshot_players.fantasy_team_id = selected_snapshot.fantasy_team_id
    and snapshot_players.fantasy_gameweek_id = selected_snapshot.fantasy_gameweek_id
  left join result_totals on result_totals.player_id = snapshot_players.player_id
  left join fixture_bonuses on fixture_bonuses.player_id = snapshot_players.player_id
  left join clinching_totals on clinching_totals.player_id = snapshot_players.player_id
  order by snapshot_players.player_id;
$$;

create or replace function public.get_player_statistics_rows(p_player_id uuid default null)
returns table (
  player_id uuid, gameweek_id uuid, gameweek_name text, round_order integer,
  starts_at timestamptz, is_final boolean, fantasy_points bigint,
  singles_wins bigint, singles_losses bigint, doubles_wins bigint, doubles_losses bigint,
  singles_sets_won bigint, singles_sets_lost bigint, singles_set_points bigint,
  singles_won_match_sets_won bigint, singles_won_match_sets_lost bigint, singles_won_match_set_points bigint,
  singles_lost_match_sets_won bigint, singles_lost_match_sets_lost bigint, singles_lost_match_set_points bigint
)
language sql stable security definer set search_path = ''
as $$
  with visible_weeks as (
    select g.* from public.fantasy_gameweeks g
    where public.gameweek_results_are_visible(g.first_match_starts_at)
      and g.data_refreshed_at is not null
      and now() > g.unlock_at
  ), context as (
    select s.stupa_submatch_id, m.fantasy_gameweek_id,
      exists (
        select 1 from public.player_submatch_results r
        where r.stupa_submatch_id = s.stupa_submatch_id
        group by r.team_stupa_participant_id having count(*) > 1
      ) as is_doubles,
      exists (
        select 1 from public.player_submatch_results r
        where r.stupa_submatch_id = s.stupa_submatch_id
          and (r.walkover or nullif(r.raw_payload #>> '{side,walkover_reason}', '') is not null)
      ) as is_walkover
    from public.stupa_submatches s
    join public.matches m on m.id = s.match_id
    join visible_weeks g on g.id = m.fantasy_gameweek_id
    where upper(s.status) = 'SCORED'
      and lower(m.status) not in ('cancelled', 'canceled', 'deleted')
      and (p_player_id is null or exists (
        select 1 from public.player_submatch_results r
        where r.stupa_submatch_id = s.stupa_submatch_id and r.player_id = p_player_id
      ))
  ), components as (
    select r.player_id, c.fantasy_gameweek_id, c.is_doubles, r.won,
      case when c.is_walkover then case when r.won then 3 else 0 end else r.sets_won end as sets_won,
      case when c.is_walkover then 0 else r.sets_lost end as sets_lost,
      case when c.is_doubles then 0
        when c.is_walkover then case when r.won then 3 else 0 end
        when r.won then greatest(r.sets_won - r.sets_lost, 0)
        else r.sets_won end as set_points
    from context c join public.player_submatch_results r using (stupa_submatch_id)
    where r.player_id is not null and (p_player_id is null or r.player_id = p_player_id)
  ), totals as (
    select c.player_id, c.fantasy_gameweek_id,
      count(*) filter (where not c.is_doubles and c.won) as singles_wins,
      count(*) filter (where not c.is_doubles and not c.won) as singles_losses,
      count(*) filter (where c.is_doubles and c.won) as doubles_wins,
      count(*) filter (where c.is_doubles and not c.won) as doubles_losses,
      sum(c.sets_won) filter (where not c.is_doubles) as singles_sets_won,
      sum(c.sets_lost) filter (where not c.is_doubles) as singles_sets_lost,
      sum(c.set_points) as singles_set_points,
      sum(c.sets_won) filter (where not c.is_doubles and c.won) as singles_won_match_sets_won,
      sum(c.sets_lost) filter (where not c.is_doubles and c.won) as singles_won_match_sets_lost,
      sum(c.set_points) filter (where not c.is_doubles and c.won) as singles_won_match_set_points,
      sum(c.sets_won) filter (where not c.is_doubles and not c.won) as singles_lost_match_sets_won,
      sum(c.sets_lost) filter (where not c.is_doubles and not c.won) as singles_lost_match_sets_lost,
      sum(c.set_points) filter (where not c.is_doubles and not c.won) as singles_lost_match_set_points
    from components c group by c.player_id, c.fantasy_gameweek_id
  ), points as (
    select s.player_id, m.fantasy_gameweek_id, sum(s.fantasy_points) as fantasy_points
    from public.player_match_stats s join public.matches m on m.id = s.match_id
    join visible_weeks g on g.id = m.fantasy_gameweek_id
    where p_player_id is null or s.player_id = p_player_id
    group by s.player_id, m.fantasy_gameweek_id
  )
  select p.id, g.id, g.name, g.round_order, g.first_match_starts_at,
    g.data_refreshed_at is not null, coalesce(pt.fantasy_points, 0),
    coalesce(t.singles_wins, 0), coalesce(t.singles_losses, 0),
    coalesce(t.doubles_wins, 0), coalesce(t.doubles_losses, 0),
    coalesce(t.singles_sets_won, 0), coalesce(t.singles_sets_lost, 0), coalesce(t.singles_set_points, 0),
    coalesce(t.singles_won_match_sets_won, 0), coalesce(t.singles_won_match_sets_lost, 0), coalesce(t.singles_won_match_set_points, 0),
    coalesce(t.singles_lost_match_sets_won, 0), coalesce(t.singles_lost_match_sets_lost, 0), coalesce(t.singles_lost_match_set_points, 0)
  from public.players p cross join visible_weeks g
  left join totals t on t.player_id = p.id and t.fantasy_gameweek_id = g.id
  left join points pt on pt.player_id = p.id and pt.fantasy_gameweek_id = g.id
  where (p_player_id is null and p.active) or p.id = p_player_id
  order by g.first_match_starts_at desc, g.id;
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
declare
  locked_gameweek_count integer;
  team_snapshot_count integer;
  player_snapshot_count integer;
  stage integer;
begin
  for stage in select distinct stupa_stage_id from public.fantasy_gameweeks where now() >= lock_at and data_refreshed_at is null order by 1 loop
    perform private.gameweek_stage_lock(stage);
  end loop;
  select count(*)::integer
  into locked_gameweek_count
  from public.fantasy_gameweeks
  where now() >= lock_at
    and now() <= unlock_at and data_refreshed_at is null;

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
    and now() <= fantasy_gameweeks.unlock_at and fantasy_gameweeks.data_refreshed_at is null
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
    and now() <= fantasy_gameweeks.unlock_at and fantasy_gameweeks.data_refreshed_at is null
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
    and now() <= fantasy_gameweeks.unlock_at and fantasy_gameweeks.data_refreshed_at is null;

  update public.fantasy_team_chip_selections as chip_selections
  set locked_at = now()
  from public.fantasy_gameweeks
  where fantasy_gameweeks.id = chip_selections.fantasy_gameweek_id
    and chip_selections.locked_at is null
    and now() >= fantasy_gameweeks.lock_at
    and now() <= fantasy_gameweeks.unlock_at and fantasy_gameweeks.data_refreshed_at is null
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
    and now() <= fantasy_gameweeks.unlock_at and fantasy_gameweeks.data_refreshed_at is null
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
    and now() <= fantasy_gameweeks.unlock_at and fantasy_gameweeks.data_refreshed_at is null
  on conflict (fantasy_team_id, fantasy_gameweek_id, player_id) do nothing;

  get diagnostics player_snapshot_count = row_count;

  return query
  select locked_gameweek_count, team_snapshot_count, player_snapshot_count;
end;
$$;

commit;

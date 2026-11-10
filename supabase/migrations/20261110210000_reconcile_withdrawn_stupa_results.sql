-- Explicit child resets/deletions retract a result. Omitted positions retain
-- the existing partial-response protection. Keep the two-argument RPC usable
-- while the migration and importer are promoted through staging separately.
create function public.persist_stupa_results(
  p_submatches jsonb,
  p_player_results jsonb,
  p_retracted_submatches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer;
  replaced_count integer;
  retracted_gameweek_ids uuid[];
begin
  if jsonb_typeof(p_submatches) is distinct from 'array'
    or jsonb_typeof(p_player_results) is distinct from 'array'
    or jsonb_typeof(p_retracted_submatches) is distinct from 'array' then
    raise exception 'Stupa results and retractions must be arrays';
  end if;

  if exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_retracted_submatches) r
    where r.stupa_submatch_id is null or r.match_id is null
      or r.match_order is null or r.match_order < 1 or r.is_golden_match is null
      or not exists (select 1 from public.matches m where m.id = r.match_id)
  ) then
    raise exception 'Stupa retractions require a known fixture, ID, kind and positive match order';
  end if;

  if exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_retracted_submatches) r
    group by r.match_id, r.is_golden_match, r.match_order having count(*) > 1
  ) or exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_retracted_submatches) r
    group by r.stupa_submatch_id having count(*) > 1
  ) or exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_retracted_submatches) r
    join jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) s
      on s.stupa_submatch_id = r.stupa_submatch_id
      or (s.match_id = r.match_id and s.is_golden_match = r.is_golden_match and s.match_order = r.match_order)
  ) then
    raise exception 'Ambiguous Stupa results: duplicate or scored retraction';
  end if;

  -- Lock the complete batch before deleting or delegating scored replacements.
  -- This is also the lock order used by the two-argument persistence function.
  perform m.id from public.matches m
  where m.id in (
    select s.match_id from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) s
    union
    select r.match_id from jsonb_populate_recordset(null::public.stupa_submatches, p_retracted_submatches) r
  )
  order by m.id for update;

  if exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_retracted_submatches) r
    join public.stupa_submatches stored using (stupa_submatch_id)
    where stored.match_id <> r.match_id
      or stored.is_golden_match <> r.is_golden_match or stored.match_order <> r.match_order
  ) then
    raise exception 'Stupa retraction ID already belongs to another fixture position';
  end if;

  -- Remove every old ID at an explicitly withdrawn position, including IDs
  -- superseded by STUPA before the reset. Player results cascade away with it.
  with removed as (
    delete from public.stupa_submatches stored
    where exists (
      select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_retracted_submatches) r
      where stored.match_id = r.match_id and stored.is_golden_match = r.is_golden_match
        and stored.match_order = r.match_order
    )
    returning stored.match_id
  )
  select count(*)::integer,
    coalesce(array_agg(distinct m.fantasy_gameweek_id) filter (where m.fantasy_gameweek_id is not null), '{}'::uuid[])
  into removed_count, retracted_gameweek_ids
  from removed join public.matches m on m.id = removed.match_id;

  -- Scoring is a subsequent RPC. If it failed after a withdrawal committed,
  -- a retry must still rescore stale derived statistics even with no children
  -- left to delete. Never-played fixtures have no statistics to refresh.
  select coalesce(array_agg(distinct weeks.id), '{}'::uuid[])
  into retracted_gameweek_ids
  from (
    select unnest(retracted_gameweek_ids) as id
    union
    select m.fantasy_gameweek_id
    from public.matches m
    where m.fantasy_gameweek_id is not null
      and exists (
        select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_retracted_submatches) r
        where r.match_id = m.id
      )
      and exists (select 1 from public.player_match_stats stats where stats.match_id = m.id)
  ) weeks;

  -- Any validation/write failure here rolls back the withdrawals as well.
  replaced_count := public.persist_stupa_results(p_submatches, p_player_results);
  return jsonb_build_object(
    'removed_count', removed_count + replaced_count,
    'retracted_gameweek_ids', retracted_gameweek_ids
  );
end;
$$;

revoke all on function public.persist_stupa_results(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_stupa_results(jsonb, jsonb, jsonb) to service_role;

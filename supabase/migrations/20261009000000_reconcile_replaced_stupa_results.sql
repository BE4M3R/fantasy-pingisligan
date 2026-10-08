-- STUPA can republish an individual match under a new ID. Match order within
-- its parent fixture and singles/golden kind identifies the logical result.
-- Replace observed positions atomically; an omitted position is not evidence
-- of deletion, since a live response can be incomplete.
create function public.persist_stupa_results(p_submatches jsonb, p_player_results jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer;
begin
  if jsonb_typeof(p_submatches) is distinct from 'array'
    or jsonb_typeof(p_player_results) is distinct from 'array' then
    raise exception 'Stupa results must be arrays';
  end if;

  if exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) s
    where s.stupa_submatch_id is null or s.match_id is null
      or s.match_order is null or s.match_order < 1
      or s.is_golden_match is null or s.status is distinct from 'SCORED'
  ) then
    raise exception 'Scored Stupa results require a fixture, ID, kind and positive match order';
  end if;

  if exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) s
    group by s.match_id, s.is_golden_match, s.match_order having count(*) > 1
  ) or exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) s
    group by s.stupa_submatch_id having count(*) > 1
  ) then
    raise exception 'Ambiguous Stupa results: duplicate ID or fixture position';
  end if;

  if exists (
    select 1 from jsonb_populate_recordset(null::public.player_submatch_results, p_player_results) r
    where not exists (
      select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) s
      where s.stupa_submatch_id = r.stupa_submatch_id
    )
  ) then
    raise exception 'Player results must belong to this Stupa result batch';
  end if;

  -- Serialize writers to the same fixture, using a stable lock order. Row
  -- locks cover both existing and newly assigned STUPA child IDs.
  perform m.id from public.matches m
  where m.id in (
    select s.match_id from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) s
  )
  order by m.id for update;

  if exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) incoming
    join public.stupa_submatches stored using (stupa_submatch_id)
    where stored.match_id <> incoming.match_id
  ) then
    raise exception 'Stupa result ID already belongs to another fixture';
  end if;

  delete from public.stupa_submatches stored
  where exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) incoming
    where incoming.match_id = stored.match_id
      and incoming.is_golden_match = stored.is_golden_match
      and incoming.match_order = stored.match_order
  ) and not exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) incoming
    where incoming.stupa_submatch_id = stored.stupa_submatch_id
  );
  get diagnostics removed_count = row_count;
  -- The FK cascade also removes obsolete player results, before scoring.

  insert into public.stupa_submatches (
    stupa_submatch_id, match_id, match_order, status, is_golden_match,
    winning_team_stupa_id, raw_payload, source_updated_at
  )
  select s.stupa_submatch_id, s.match_id, s.match_order, s.status, s.is_golden_match,
    s.winning_team_stupa_id, s.raw_payload, coalesce(s.source_updated_at, now())
  from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) s
  on conflict (stupa_submatch_id) do update set
    match_order = excluded.match_order,
    status = excluded.status,
    is_golden_match = excluded.is_golden_match,
    winning_team_stupa_id = excluded.winning_team_stupa_id,
    raw_payload = excluded.raw_payload,
    source_updated_at = excluded.source_updated_at;

  -- A corrected lineup can also change player IDs without changing the child
  -- match ID. Keep exactly the observed participants of each incoming child.
  delete from public.player_submatch_results stored
  where exists (
    select 1 from jsonb_populate_recordset(null::public.stupa_submatches, p_submatches) s
    where s.stupa_submatch_id = stored.stupa_submatch_id
  ) and not exists (
    select 1 from jsonb_populate_recordset(null::public.player_submatch_results, p_player_results) r
    where r.stupa_submatch_id = stored.stupa_submatch_id
      and r.stupa_user_role_id = stored.stupa_user_role_id
  );

  insert into public.player_submatch_results (
    stupa_submatch_id, player_id, stupa_user_role_id, stupa_license_id, player_name,
    team_stupa_participant_id, side_order, lineup_label, won, sets_won, sets_lost,
    points_won, points_lost, set_wins, set_points, walkover, raw_payload, source_updated_at
  )
  select r.stupa_submatch_id, r.player_id, r.stupa_user_role_id, r.stupa_license_id, r.player_name,
    r.team_stupa_participant_id, r.side_order, r.lineup_label, r.won,
    coalesce(r.sets_won, 0), coalesce(r.sets_lost, 0),
    coalesce(r.points_won, 0), coalesce(r.points_lost, 0),
    coalesce(r.set_wins, '{}'), coalesce(r.set_points, '{}'),
    coalesce(r.walkover, false), r.raw_payload, coalesce(r.source_updated_at, now())
  from jsonb_populate_recordset(null::public.player_submatch_results, p_player_results) r
  on conflict (stupa_submatch_id, stupa_user_role_id) do update set
    player_id = excluded.player_id,
    stupa_license_id = excluded.stupa_license_id,
    player_name = excluded.player_name,
    team_stupa_participant_id = excluded.team_stupa_participant_id,
    side_order = excluded.side_order,
    lineup_label = excluded.lineup_label,
    won = excluded.won,
    sets_won = excluded.sets_won,
    sets_lost = excluded.sets_lost,
    points_won = excluded.points_won,
    points_lost = excluded.points_lost,
    set_wins = excluded.set_wins,
    set_points = excluded.set_points,
    walkover = excluded.walkover,
    raw_payload = excluded.raw_payload,
    source_updated_at = excluded.source_updated_at;

  return removed_count;
end;
$$;

revoke all on function public.persist_stupa_results(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_stupa_results(jsonb, jsonb) to service_role;

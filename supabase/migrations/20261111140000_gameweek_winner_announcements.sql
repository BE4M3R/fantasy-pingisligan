begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Store the reviewed result separately from live standings. No contact or
-- delivery information belongs in the announcement or its public projection.
create table private.gameweek_competition_winners (
  gameweek_id uuid primary key references public.fantasy_gameweeks(id) on delete cascade,
  team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  team_name text not null,
  points integer not null,
  selection_method text not null check (selection_method in ('ranking', 'random_draw')),
  rules_version_id uuid not null references public.competition_rules(id),
  candidate_snapshot jsonb not null,
  score_count integer not null,
  needs_review boolean not null default false,
  announced_at timestamptz not null default clock_timestamp(),
  withdrawn_at timestamptz
);
alter table private.gameweek_competition_winners enable row level security;
revoke all on private.gameweek_competition_winners from public, anon, authenticated, service_role;

-- Recheck once per completed scoring statement, rather than reranking every
-- squad on every Home request. The scorer temporarily clears player points
-- before writing final team totals, so player-row triggers would invalidate
-- unchanged nightly imports. Earlier rounds can affect the season tie-break.
create function private.invalidate_competition_winners()
returns trigger language plpgsql security definer set search_path = '' as $$
declare decision record; review jsonb;
begin
  for decision in
    select w.gameweek_id, w.candidate_snapshot from private.gameweek_competition_winners w
    join public.fantasy_gameweeks target on target.id = w.gameweek_id
    where not w.needs_review and w.withdrawn_at is null and exists (
      select 1 from changed_scores s join public.fantasy_gameweeks changed on changed.id = s.fantasy_gameweek_id
      where changed.lock_at <= target.lock_at
    )
  loop
    review := public.get_weekly_competition_review(decision.gameweek_id);
    if review->>'status' not in ('provisional_leader', 'draw_required')
      or review->'prize_candidates' is distinct from decision.candidate_snapshot then
      update private.gameweek_competition_winners set needs_review = true where gameweek_id = decision.gameweek_id;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.invalidate_competition_winners() from public, anon, authenticated, service_role;
create trigger invalidate_competition_winner_score_insert
after insert on public.fantasy_team_gameweek_points referencing new table as changed_scores
for each statement execute function private.invalidate_competition_winners();
create trigger invalidate_competition_winner_score_update
after update on public.fantasy_team_gameweek_points referencing new table as changed_scores
for each statement execute function private.invalidate_competition_winners();
create trigger invalidate_competition_winner_score_delete
after delete on public.fantasy_team_gameweek_points referencing old table as changed_scores
for each statement execute function private.invalidate_competition_winners();

-- An operator must review the result and explicitly confirm the expected team.
-- A complete tie requires a separate explicit opt-in to one persisted draw.
create function public.confirm_gameweek_competition_winner(
  p_gameweek_id uuid, p_expected_team_id uuid, p_allow_draw boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  review jsonb;
  candidate jsonb;
  rules_id uuid;
  existing private.gameweek_competition_winners;
begin
  perform 1 from public.fantasy_gameweeks where id = p_gameweek_id for update;
  if not public.competitions_enabled() or not exists (
    select 1 from public.competition_publication where gameweek_id = p_gameweek_id and enabled
  ) then
    raise exception 'This Gameweek has no published prize competition.';
  end if;
  select * into existing from private.gameweek_competition_winners where gameweek_id = p_gameweek_id;
  if found then
    -- Retrying never redraws or silently replaces a confirmed winner.
    if existing.withdrawn_at is not null then raise exception 'This announcement was withdrawn; operator review is required.'; end if;
    if p_expected_team_id is not null and existing.team_id <> p_expected_team_id then
      raise exception 'A different winner has already been confirmed.';
    end if;
    if not exists (select 1 from public.get_public_competition_winners(p_gameweek_id)) then
      raise exception 'The confirmed result has changed or been hidden; operator review is required.';
    end if;
    return jsonb_build_object('team_name', existing.team_name, 'points', existing.points,
      'selection_method', existing.selection_method, 'announced_at', existing.announced_at);
  end if;
  select b.rules_version_id into rules_id from public.homepage_banners b
    join public.competition_rules r on r.id = b.rules_version_id and r.approved_at is not null
    where b.gameweek_id = p_gameweek_id and b.content_ready;
  if rules_id is null then raise exception 'A ready prize and approved rules are required.'; end if;
  review := public.get_weekly_competition_review(p_gameweek_id);
  if review is null or review->>'status' not in ('provisional_leader', 'draw_required')
    or not exists (select 1 from public.fantasy_gameweeks where id = p_gameweek_id and unlock_at <= now()) then
    raise exception 'Complete results and a successful Gameweek refresh are required.';
  end if;
  if review->>'status' = 'draw_required' then
    if not coalesce(p_allow_draw, false) or p_expected_team_id is not null then
      raise exception 'A tied result requires an explicit random draw with no preselected team.';
    end if;
    select value into candidate from jsonb_array_elements(review->'prize_candidates') order by gen_random_uuid() limit 1;
  else
    candidate := review->'prize_candidates'->0;
    if p_expected_team_id is distinct from (candidate->>'team_id')::uuid then
      raise exception 'The expected winner does not match the reviewed result.';
    end if;
  end if;
  insert into private.gameweek_competition_winners (gameweek_id, team_id, team_name, points,
    selection_method, rules_version_id, candidate_snapshot, score_count)
  values (p_gameweek_id, (candidate->>'team_id')::uuid, candidate->>'team_name', (candidate->>'points')::integer,
    case when review->>'status' = 'draw_required' then 'random_draw' else 'ranking' end,
    rules_id, review->'prize_candidates', (select count(*) from public.fantasy_team_gameweek_points where fantasy_gameweek_id = p_gameweek_id))
  returning * into existing;
  return jsonb_build_object('team_name', existing.team_name, 'points', existing.points,
    'selection_method', existing.selection_method, 'announced_at', existing.announced_at);
end;
$$;
revoke all on function public.confirm_gameweek_competition_winner(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.confirm_gameweek_competition_winner(uuid, uuid, boolean) to service_role;

create function public.withdraw_gameweek_competition_winner(p_gameweek_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update private.gameweek_competition_winners set withdrawn_at = coalesce(withdrawn_at, clock_timestamp())
  where gameweek_id = p_gameweek_id;
$$;
revoke all on function public.withdraw_gameweek_competition_winner(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_gameweek_competition_winner(uuid) to service_role;

-- One bounded batch read supplies Home; detail pages filter by the public GW ID.
-- A changed score hides the announcement pending operator review. There
-- is no automatic redraw, award replacement, email or social-media publication.
create function public.get_public_competition_winners(p_gameweek_id uuid default null)
returns table (gameweek_id uuid, team_name text, points integer, selection_method text, announced_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select w.gameweek_id, w.team_name, w.points, w.selection_method, w.announced_at
  from private.gameweek_competition_winners w
  join public.fantasy_gameweeks g on g.id = w.gameweek_id
  join public.competition_publication p on p.gameweek_id = w.gameweek_id and p.enabled
  where public.competitions_enabled() and w.withdrawn_at is null and not w.needs_review
    and (p_gameweek_id is null or w.gameweek_id = p_gameweek_id)
    and g.unlock_at <= now() and g.data_refreshed_at is not null
    and exists (select 1 from public.homepage_banners b where b.gameweek_id = w.gameweek_id and b.content_ready)
    and exists (select 1 from public.matches m where m.fantasy_gameweek_id = w.gameweek_id)
    and not exists (select 1 from public.matches m where m.fantasy_gameweek_id = w.gameweek_id and lower(m.status) <> 'scored')
    and (select count(*) from public.fantasy_team_gameweek_points s where s.fantasy_gameweek_id = w.gameweek_id) = w.score_count
  order by g.lock_at, w.gameweek_id;
$$;
revoke all on function public.get_public_competition_winners(uuid) from public;
grant execute on function public.get_public_competition_winners(uuid) to anon, authenticated, service_role;

commit;

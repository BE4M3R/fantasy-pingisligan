-- Preserve the visible lineup order. The two bench slots use this order as
-- their automatic-substitution priority.
alter table public.fantasy_team_players
add column lineup_order smallint;

alter table public.fantasy_team_gameweek_players
add column lineup_order smallint;

-- There was no persisted order before this migration. Prefer insertion order
-- for existing rows and use the primary-key value as a stable final tie-break.
with ranked_players as (
  select
    ctid,
    row_number() over (
      partition by fantasy_team_id
      order by
        case when position = 'starter' then 0 else 1 end,
        created_at,
        ctid,
        player_id
    ) - 1 as lineup_order
  from public.fantasy_team_players
)
update public.fantasy_team_players as players
set lineup_order = ranked_players.lineup_order
from ranked_players
where players.ctid = ranked_players.ctid;

with ranked_snapshot_players as (
  select
    ctid,
    row_number() over (
      partition by fantasy_team_id, fantasy_gameweek_id
      order by
        case when position = 'starter' then 0 else 1 end,
        created_at,
        ctid,
        player_id
    ) - 1 as lineup_order
  from public.fantasy_team_gameweek_players
)
update public.fantasy_team_gameweek_players as players
set lineup_order = ranked_snapshot_players.lineup_order
from ranked_snapshot_players
where players.ctid = ranked_snapshot_players.ctid;

alter table public.fantasy_team_players
alter column lineup_order set not null;

alter table public.fantasy_team_gameweek_players
alter column lineup_order set not null;

alter table public.fantasy_team_players
add constraint fantasy_team_players_lineup_order_check
check (lineup_order between 0 and 5);

alter table public.fantasy_team_players
add constraint fantasy_team_players_lineup_order_unique
unique (fantasy_team_id, lineup_order)
deferrable initially deferred;

alter table public.fantasy_team_gameweek_players
add constraint fantasy_team_gameweek_players_lineup_order_check
check (lineup_order between 0 and 5);

alter table public.fantasy_team_gameweek_players
add constraint fantasy_team_gameweek_players_lineup_order_unique
unique (fantasy_team_id, fantasy_gameweek_id, lineup_order)
deferrable initially deferred;

-- Existing save and snapshot functions predate lineup_order. These triggers
-- provide a valid temporary order before the save wrapper applies the exact
-- JSON array order, and copy that order into every locked snapshot.
create or replace function public.assign_fantasy_team_player_lineup_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lineup_order is null then
    select available_slots.slot::smallint
    into new.lineup_order
    from generate_series(0, 5) as available_slots(slot)
    where not exists (
      select 1
      from public.fantasy_team_players as players
      where players.fantasy_team_id = new.fantasy_team_id
        and players.lineup_order = available_slots.slot
    )
    order by available_slots.slot
    limit 1;
  end if;

  if new.lineup_order is null then
    raise exception 'A squad cannot contain more than six player slots.';
  end if;

  return new;
end;
$$;

revoke all on function public.assign_fantasy_team_player_lineup_order()
from public, anon, authenticated;

create trigger assign_fantasy_team_player_lineup_order
before insert on public.fantasy_team_players
for each row execute function public.assign_fantasy_team_player_lineup_order();

create or replace function public.assign_snapshot_player_lineup_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lineup_order is null then
    select players.lineup_order
    into new.lineup_order
    from public.fantasy_team_players as players
    where players.fantasy_team_id = new.fantasy_team_id
      and players.player_id = new.player_id;
  end if;

  if new.lineup_order is null then
    raise exception 'A locked squad player must have a lineup order.';
  end if;

  return new;
end;
$$;

revoke all on function public.assign_snapshot_player_lineup_order()
from public, anon, authenticated;

create trigger assign_snapshot_player_lineup_order
before insert on public.fantasy_team_gameweek_players
for each row execute function public.assign_snapshot_player_lineup_order();

alter function public.save_my_fantasy_team(uuid, jsonb, text)
rename to save_my_fantasy_team_without_lineup_order;

revoke all on function public.save_my_fantasy_team_without_lineup_order(uuid, jsonb, text)
from public, anon, authenticated;

create function public.save_my_fantasy_team(
  p_gameweek_id uuid,
  p_squad jsonb,
  p_chip text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.save_my_fantasy_team_without_lineup_order(
    p_gameweek_id,
    p_squad,
    p_chip
  );

  update public.fantasy_team_players as players
  set lineup_order = (draft.ordinality - 1)::smallint
  from public.fantasy_teams as teams,
    jsonb_array_elements(p_squad) with ordinality as draft(value, ordinality)
  where teams.user_id = auth.uid()
    and players.fantasy_team_id = teams.id
    and players.player_id = (draft.value ->> 'player_id')::uuid;
end;
$$;

revoke all on function public.save_my_fantasy_team(uuid, jsonb, text)
from public, anon, authenticated;

-- Keep the existing result calculations intact, but expose their rows in the
-- locked lineup order so the application applies substitutions consistently.
alter function public.get_my_squad_result(uuid)
rename to get_my_squad_result_without_lineup_order;

revoke all on function public.get_my_squad_result_without_lineup_order(uuid)
from public, anon, authenticated;

create function public.get_my_squad_result(target_gameweek_id uuid)
returns table (
  gameweek_id uuid,
  gameweek_name text,
  round_order integer,
  active_chip text,
  player_id uuid,
  first_name text,
  last_name text,
  club_id uuid,
  club_name text,
  price numeric,
  "position" text,
  is_captain boolean,
  fantasy_points integer,
  singles_wins integer,
  singles_losses integer,
  doubles_wins integer,
  doubles_losses integer,
  sets_won integer,
  sets_lost integer,
  match_win_points integer,
  set_points integer,
  fixture_win_points integer,
  sweep_bonus_points integer,
  captain_bonus_points integer,
  counts_for_team boolean,
  team_points_contribution integer
)
language sql
security definer
set search_path = ''
stable
as $$
  select unordered_results.*
  from public.get_my_squad_result_without_lineup_order(
    target_gameweek_id
  ) as unordered_results
  join public.fantasy_team_gameweek_players as snapshot_players
    on snapshot_players.fantasy_gameweek_id = unordered_results.gameweek_id
    and snapshot_players.player_id = unordered_results.player_id
  join public.fantasy_teams as teams
    on teams.id = snapshot_players.fantasy_team_id
    and teams.user_id = auth.uid()
  order by snapshot_players.lineup_order;
$$;

revoke all on function public.get_my_squad_result(uuid) from public;
grant execute on function public.get_my_squad_result(uuid) to authenticated;

alter function public.get_my_latest_squad_result()
rename to get_my_latest_squad_result_without_lineup_order;

revoke all on function public.get_my_latest_squad_result_without_lineup_order()
from public, anon, authenticated;

create function public.get_my_latest_squad_result()
returns table (
  gameweek_id uuid,
  gameweek_name text,
  round_order integer,
  active_chip text,
  player_id uuid,
  first_name text,
  last_name text,
  club_id uuid,
  club_name text,
  price numeric,
  "position" text,
  is_captain boolean,
  fantasy_points integer,
  singles_wins integer,
  singles_losses integer,
  doubles_wins integer,
  doubles_losses integer,
  sets_won integer,
  sets_lost integer,
  match_win_points integer,
  set_points integer,
  fixture_win_points integer,
  sweep_bonus_points integer,
  captain_bonus_points integer,
  counts_for_team boolean,
  team_points_contribution integer
)
language sql
security definer
set search_path = ''
stable
as $$
  select unordered_results.*
  from public.get_my_latest_squad_result_without_lineup_order()
    as unordered_results
  join public.fantasy_team_gameweek_players as snapshot_players
    on snapshot_players.fantasy_gameweek_id = unordered_results.gameweek_id
    and snapshot_players.player_id = unordered_results.player_id
  join public.fantasy_teams as teams
    on teams.id = snapshot_players.fantasy_team_id
    and teams.user_id = auth.uid()
  order by snapshot_players.lineup_order;
$$;

revoke all on function public.get_my_latest_squad_result() from public;
grant execute on function public.get_my_latest_squad_result() to authenticated;

-- Score both absent starters and available bench players by their locked slot
-- order. In particular, the left bench player is always considered first.
create or replace function public.calculate_fantasy_gameweek_points(target_gameweek_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_team_count integer;
begin
  perform public.calculate_player_match_stats(target_gameweek_id);

  update public.fantasy_team_gameweek_players
  set fantasy_points = 0
  where fantasy_gameweek_id = target_gameweek_id;

  with player_points as (
    select
      matches.fantasy_gameweek_id,
      player_match_stats.player_id,
      sum(player_match_stats.fantasy_points)::integer as points
    from public.player_match_stats
    join public.matches
      on matches.id = player_match_stats.match_id
    where matches.fantasy_gameweek_id = target_gameweek_id
    group by matches.fantasy_gameweek_id, player_match_stats.player_id
  )
  update public.fantasy_team_gameweek_players as snapshot_players
  set fantasy_points = coalesce(player_points.points, 0)
  from player_points
  where snapshot_players.fantasy_gameweek_id = player_points.fantasy_gameweek_id
    and snapshot_players.player_id = player_points.player_id;

  with player_appearances as (
    select
      matches.fantasy_gameweek_id,
      player_match_stats.player_id,
      bool_or(
        player_match_stats.won_matches + player_match_stats.lost_matches > 0
      ) as played
    from public.player_match_stats
    join public.matches
      on matches.id = player_match_stats.match_id
    where matches.fantasy_gameweek_id = target_gameweek_id
    group by matches.fantasy_gameweek_id, player_match_stats.player_id
  ),
  lineup as (
    select
      snapshots.fantasy_team_id,
      snapshots.fantasy_gameweek_id,
      snapshots.active_chip,
      snapshots.transfer_penalty_points,
      snapshot_players.player_id,
      snapshot_players.position,
      snapshot_players.is_captain,
      snapshot_players.lineup_order,
      coalesce(snapshot_players.fantasy_points, 0)::integer as fantasy_points,
      coalesce(player_appearances.played, false) as played
    from public.fantasy_team_gameweek_snapshots as snapshots
    left join public.fantasy_team_gameweek_players as snapshot_players
      on snapshot_players.fantasy_team_id = snapshots.fantasy_team_id
      and snapshot_players.fantasy_gameweek_id = snapshots.fantasy_gameweek_id
    left join player_appearances
      on player_appearances.fantasy_gameweek_id =
        snapshot_players.fantasy_gameweek_id
      and player_appearances.player_id = snapshot_players.player_id
    where snapshots.fantasy_gameweek_id = target_gameweek_id
  ),
  ranked_lineup as (
    select
      lineup.*,
      count(*) filter (
        where lineup.position = 'starter' and not lineup.played
      ) over (
        partition by lineup.fantasy_team_id, lineup.fantasy_gameweek_id
      ) as missing_starter_count,
      count(*) filter (
        where lineup.position = 'starter' and not lineup.played
      ) over (
        partition by lineup.fantasy_team_id, lineup.fantasy_gameweek_id
        order by lineup.lineup_order
        rows between unbounded preceding and current row
      ) as missing_starter_rank,
      count(*) filter (
        where lineup.position = 'bench' and lineup.played
      ) over (
        partition by lineup.fantasy_team_id, lineup.fantasy_gameweek_id
        order by lineup.lineup_order
        rows between unbounded preceding and current row
      ) as playing_bench_rank
    from lineup
  ),
  missing_captain as (
    select
      ranked_lineup.fantasy_team_id,
      ranked_lineup.fantasy_gameweek_id,
      ranked_lineup.missing_starter_rank
    from ranked_lineup
    where ranked_lineup.position = 'starter'
      and ranked_lineup.is_captain
      and not ranked_lineup.played
  ),
  scored_lineup as (
    select
      ranked_lineup.*,
      case
        when ranked_lineup.active_chip = 'bench_boost' then true
        when ranked_lineup.position = 'starter' then ranked_lineup.played
        when ranked_lineup.position = 'bench' and ranked_lineup.played
          then ranked_lineup.playing_bench_rank <=
            ranked_lineup.missing_starter_count
        else false
      end as counts_for_team,
      case
        when ranked_lineup.position = 'starter'
          then ranked_lineup.is_captain and ranked_lineup.played
        when ranked_lineup.position = 'bench'
          and ranked_lineup.played
          and ranked_lineup.playing_bench_rank <=
            ranked_lineup.missing_starter_count
          then ranked_lineup.playing_bench_rank =
            missing_captain.missing_starter_rank
        else false
      end as effective_is_captain
    from ranked_lineup
    left join missing_captain
      on missing_captain.fantasy_team_id = ranked_lineup.fantasy_team_id
      and missing_captain.fantasy_gameweek_id =
        ranked_lineup.fantasy_gameweek_id
  )
  insert into public.fantasy_team_gameweek_points (
    fantasy_team_id,
    fantasy_gameweek_id,
    points,
    calculated_at,
    updated_at
  )
  select
    scored_lineup.fantasy_team_id,
    scored_lineup.fantasy_gameweek_id,
    (
      coalesce(
        sum(
          case
            when not scored_lineup.counts_for_team then 0
            when scored_lineup.effective_is_captain
              and scored_lineup.active_chip = 'triple_captain'
              then scored_lineup.fantasy_points * 3
            when scored_lineup.effective_is_captain
              then scored_lineup.fantasy_points * 2
            else scored_lineup.fantasy_points
          end
        ),
        0
      ) + scored_lineup.transfer_penalty_points
    )::integer as points,
    now(),
    now()
  from scored_lineup
  group by
    scored_lineup.fantasy_team_id,
    scored_lineup.fantasy_gameweek_id,
    scored_lineup.active_chip,
    scored_lineup.transfer_penalty_points
  on conflict (fantasy_team_id, fantasy_gameweek_id) do update
  set points = excluded.points,
      calculated_at = excluded.calculated_at,
      updated_at = excluded.updated_at;

  get diagnostics updated_team_count = row_count;

  return updated_team_count;
end;
$$;

revoke all on function public.calculate_fantasy_gameweek_points(uuid) from public;
grant execute on function public.calculate_fantasy_gameweek_points(uuid) to service_role;

-- Align already-scored gameweeks with the persisted snapshot order.
do $$
declare
  scored_gameweek record;
begin
  for scored_gameweek in
    select distinct snapshots.fantasy_gameweek_id
    from public.fantasy_team_gameweek_snapshots as snapshots
    join public.fantasy_team_gameweek_points as points
      on points.fantasy_team_id = snapshots.fantasy_team_id
      and points.fantasy_gameweek_id = snapshots.fantasy_gameweek_id
  loop
    perform public.calculate_fantasy_gameweek_points(
      scored_gameweek.fantasy_gameweek_id
    );
  end loop;
end;
$$;

-- An inactive player may remain in the squad that already owns them, at their
-- preserved price. They still cannot be selected by a new owner or re-added
-- after being transferred out.

create or replace function public.save_my_fantasy_team(
  p_gameweek_id uuid,
  p_squad jsonb,
  p_chip text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_team_id uuid;
  current_team_budget numeric;
  squad_count integer;
  distinct_player_count integer;
  starter_count integer;
  bench_count integer;
  captain_count integer;
  valid_player_count integer;
  squad_cost numeric;
  target_lock_at timestamptz;
  confirmed_chip text;
begin
  if current_user_id is null then
    raise exception 'You must be signed in to save a team.';
  end if;

  select fantasy_teams.id, fantasy_teams.budget
  into current_team_id, current_team_budget
  from public.fantasy_teams
  where fantasy_teams.user_id = current_user_id
  for update;

  if current_team_id is null then
    raise exception 'Fantasy team not found.';
  end if;

  if public.transfers_are_locked() then
    raise exception 'The transfer window is closed.';
  end if;

  if jsonb_typeof(p_squad) is distinct from 'array' then
    raise exception 'The squad must be an array.';
  end if;

  select
    count(*)::integer,
    count(distinct draft.player_id)::integer,
    count(*) filter (where draft.position = 'starter')::integer,
    count(*) filter (where draft.position = 'bench')::integer,
    count(*) filter (where draft.is_captain)::integer
  into
    squad_count,
    distinct_player_count,
    starter_count,
    bench_count,
    captain_count
  from jsonb_to_recordset(p_squad) as draft(
    player_id uuid,
    position text,
    is_captain boolean
  );

  if squad_count > 6 then
    raise exception 'A squad can contain at most six players.';
  end if;

  if distinct_player_count <> squad_count then
    raise exception 'A player can appear only once in a squad.';
  end if;

  if starter_count + bench_count <> squad_count then
    raise exception 'Every player must be a main or bench player.';
  end if;

  if starter_count > 4 or bench_count > 2 then
    raise exception 'A squad can contain at most four main and two bench players.';
  end if;

  if (squad_count = 0 and captain_count <> 0)
    or (squad_count > 0 and captain_count <> 1) then
    raise exception 'Choose exactly one captain.';
  end if;

  select count(*)::integer, coalesce(sum(players.price), 0)
  into valid_player_count, squad_cost
  from jsonb_to_recordset(p_squad) as draft(
    player_id uuid,
    position text,
    is_captain boolean
  )
  join public.players
    on players.id = draft.player_id
  where players.active
    or exists (
      select 1
      from public.fantasy_team_players as owned_player
      where owned_player.fantasy_team_id = current_team_id
        and owned_player.player_id = players.id
    );

  if valid_player_count <> squad_count then
    raise exception 'One or more selected players are unavailable.';
  end if;

  if squad_cost > current_team_budget then
    raise exception 'That squad exceeds the team budget.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_squad) as draft(
      player_id uuid,
      position text,
      is_captain boolean
    )
    join public.players
      on players.id = draft.player_id
    where players.club_id is not null
    group by players.club_id
    having count(*) > 2
  ) then
    raise exception 'You can select a maximum of two players from the same club.';
  end if;

  if p_chip is not null
    and p_chip not in ('wildcard', 'triple_captain', 'bench_boost') then
    raise exception 'Choose a valid chip.';
  end if;

  if p_gameweek_id is not null then
    select fantasy_gameweeks.lock_at
    into target_lock_at
    from public.fantasy_gameweeks
    where fantasy_gameweeks.id = p_gameweek_id;

    if target_lock_at is null then
      raise exception 'Gameweek not found.';
    end if;

    if now() >= target_lock_at then
      raise exception 'That gameweek is already locked.';
    end if;
  elsif p_chip is not null then
    raise exception 'No upcoming gameweek found for the selected chip.';
  end if;

  select chip
  into confirmed_chip
  from public.fantasy_team_chip_selections
  where fantasy_team_id = current_team_id
    and fantasy_gameweek_id = p_gameweek_id;

  if confirmed_chip is not null and p_chip is distinct from confirmed_chip then
    raise exception 'The confirmed chip cannot be changed for this gameweek.';
  end if;

  if p_chip is not null and confirmed_chip is null and exists (
    select 1
    from public.fantasy_team_chip_selections
    where fantasy_team_id = current_team_id
      and chip = p_chip
  ) then
    raise exception 'That chip has already been used this season.';
  end if;

  delete from public.fantasy_team_players
  where fantasy_team_id = current_team_id;

  insert into public.fantasy_team_players (
    fantasy_team_id,
    player_id,
    position,
    is_captain
  )
  select
    current_team_id,
    draft.player_id,
    draft.position,
    draft.is_captain
  from jsonb_to_recordset(p_squad) as draft(
    player_id uuid,
    position text,
    is_captain boolean
  );

  if p_gameweek_id is not null then
    if p_chip is not null and confirmed_chip is null then
      insert into public.fantasy_team_chip_selections (
        fantasy_team_id,
        fantasy_gameweek_id,
        chip,
        selected_at
      )
      values (
        current_team_id,
        p_gameweek_id,
        p_chip,
        now()
      );
    end if;
  end if;
end;
$$;

revoke all on function public.save_my_fantasy_team(uuid, jsonb, text)
from public;

grant execute on function public.save_my_fantasy_team(uuid, jsonb, text)
to authenticated;

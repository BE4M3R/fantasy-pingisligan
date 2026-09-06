do $$
begin
  if exists (
    select 1
    from public.fantasy_team_players
    join public.players
      on players.id = fantasy_team_players.player_id
    where players.club_id is not null
    group by fantasy_team_players.fantasy_team_id, players.club_id
    having count(*) > 2
  ) then
    raise exception 'Cannot enable the club limit while a fantasy squad has more than two players from one club.';
  end if;
end;
$$;

create or replace function public.enforce_fantasy_team_club_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_club_id uuid;
  selected_club_count integer;
begin
  select players.club_id
  into selected_club_id
  from public.players
  where players.id = new.player_id;

  if selected_club_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)
    into selected_club_count
    from public.fantasy_team_players
    join public.players
      on players.id = fantasy_team_players.player_id
    where fantasy_team_players.fantasy_team_id = new.fantasy_team_id
      and fantasy_team_players.player_id <> old.player_id
      and players.club_id = selected_club_id;
  else
    select count(*)
    into selected_club_count
    from public.fantasy_team_players
    join public.players
      on players.id = fantasy_team_players.player_id
    where fantasy_team_players.fantasy_team_id = new.fantasy_team_id
      and players.club_id = selected_club_id;
  end if;

  if selected_club_count >= 2 then
    raise exception 'You can select a maximum of two players from the same club.'
      using errcode = '23514',
        constraint = 'fantasy_team_players_club_limit';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_fantasy_team_club_limit
on public.fantasy_team_players;

create trigger enforce_fantasy_team_club_limit
before insert or update of fantasy_team_id, player_id
on public.fantasy_team_players
for each row
execute function public.enforce_fantasy_team_club_limit();

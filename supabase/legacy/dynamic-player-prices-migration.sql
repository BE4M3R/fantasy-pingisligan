begin;

alter table public.fantasy_gameweeks
add column if not exists data_refreshed_at timestamptz;

-- Existing completed gameweeks predate refresh-gated unlocking and must not
-- become locked again when this migration is installed.
update public.fantasy_gameweeks
set data_refreshed_at = unlock_at
where data_refreshed_at is null
  and now() > unlock_at;

create or replace function public.transfers_are_locked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.fantasy_gameweeks
    where now() >= fantasy_gameweeks.lock_at
      and fantasy_gameweeks.data_refreshed_at is null
  );
$$;

revoke all on function public.transfers_are_locked() from public;
grant execute on function public.transfers_are_locked() to anon, authenticated;

create or replace function public.enforce_transfer_refresh_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_team_id uuid;
begin
  affected_team_id := case
    when tg_op = 'DELETE' then old.fantasy_team_id
    else new.fantasy_team_id
  end;

  if auth.uid() is not null
    and public.transfers_are_locked()
    and exists (
      select 1
      from public.fantasy_teams
      where fantasy_teams.id = affected_team_id
        and fantasy_teams.user_id = auth.uid()
    ) then
    raise exception 'Transfers remain closed while gameweek data and player prices are updated.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_transfer_refresh_lock() from public;

drop trigger if exists enforce_transfer_refresh_lock
on public.fantasy_team_players;

create trigger enforce_transfer_refresh_lock
before insert or update or delete
on public.fantasy_team_players
for each row
execute function public.enforce_transfer_refresh_lock();

drop trigger if exists enforce_transfer_refresh_lock
on public.fantasy_team_chip_selections;

create trigger enforce_transfer_refresh_lock
before insert or update or delete
on public.fantasy_team_chip_selections
for each row
execute function public.enforce_transfer_refresh_lock();

drop policy if exists "Users can manage their squad"
on public.fantasy_team_players;

create policy "Users can manage their squad"
on public.fantasy_team_players for all
to authenticated
using (
  not public.transfers_are_locked()
  and exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_players.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
)
with check (
  not public.transfers_are_locked()
  and exists (
    select 1
    from public.fantasy_teams
    where fantasy_teams.id = fantasy_team_players.fantasy_team_id
      and fantasy_teams.user_id = auth.uid()
  )
);

drop function if exists public.current_transfer_lock();

create function public.current_transfer_lock()
returns table (
  is_locked boolean,
  is_refreshing boolean,
  gameweek_id uuid,
  gameweek_name text,
  lock_at timestamptz,
  unlock_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    exists (
      select 1
      from public.fantasy_gameweeks
      where now() >= lock_at
        and data_refreshed_at is null
    ) as is_locked,
    coalesce(
      now() > locked_gameweek.unlock_at
        and locked_gameweek.data_refreshed_at is null,
      false
    ) as is_refreshing,
    locked_gameweek.id as gameweek_id,
    locked_gameweek.name as gameweek_name,
    locked_gameweek.lock_at,
    locked_gameweek.unlock_at
  from (
    select *
    from public.fantasy_gameweeks
    where now() >= lock_at
      and data_refreshed_at is null
    order by lock_at desc
    limit 1
  ) as locked_gameweek
  right join (select 1) as fallback on true;
$$;

grant execute on function public.current_transfer_lock() to anon, authenticated;

-- A team's budget represents its current squad value plus unspent cash. When
-- a player from the pending unlocked gameweek squad is repriced, move the
-- budget by the same amount so the price change affects team value without
-- creating or removing cash. The immutable snapshot avoids crediting a player
-- transferred in after the gameweek unlocked but before the import ran.
create or replace function public.preserve_team_cash_on_player_reprice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_unlocked_gameweek_id uuid;
begin
  select fantasy_gameweeks.id
  into latest_unlocked_gameweek_id
  from public.fantasy_gameweeks
  where now() > fantasy_gameweeks.unlock_at
    and fantasy_gameweeks.data_refreshed_at is null
  order by fantasy_gameweeks.unlock_at, fantasy_gameweeks.id
  limit 1;

  if latest_unlocked_gameweek_id is null then
    return new;
  end if;

  update public.fantasy_teams
  set
    budget = budget + (new.price - old.price),
    updated_at = now()
  where onboarding_completed
    and exists (
      select 1
      from public.fantasy_team_gameweek_players
      where fantasy_team_gameweek_players.fantasy_team_id = fantasy_teams.id
        and fantasy_team_gameweek_players.fantasy_gameweek_id =
          latest_unlocked_gameweek_id
        and fantasy_team_gameweek_players.player_id = new.id
    );

  return new;
end;
$$;

revoke all on function public.preserve_team_cash_on_player_reprice()
from public;

drop trigger if exists preserve_team_cash_on_player_reprice
on public.players;

create trigger preserve_team_cash_on_player_reprice
after update of price
on public.players
for each row
when (old.price is distinct from new.price)
execute function public.preserve_team_cash_on_player_reprice();

commit;

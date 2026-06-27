alter table public.players
  add column if not exists profixio_id text,
  add column if not exists birth_year integer,
  add column if not exists ranking_position integer,
  add column if not exists ranking_points integer,
  add column if not exists source_updated_at timestamptz;

create unique index if not exists players_profixio_id_key
on public.players (profixio_id);

alter table public.players
  alter column price type numeric(12, 0)
    using (
      case
        when price < 100000 then price * 1000000
        else price
      end
    )::numeric(12, 0),
  alter column price set default 5000000;

alter table public.fantasy_teams
  alter column budget type numeric(12, 0)
    using (
      case
        when budget < 100000 then budget * 1000000
        else budget
      end
    )::numeric(12, 0),
  alter column budget set default 100000000;

update public.fantasy_team_players
set position = 'starter'
where position not in ('starter', 'bench');

alter table public.fantasy_team_players
  add column if not exists is_captain boolean not null default false;

with first_players as (
  select distinct on (fantasy_team_id)
    fantasy_team_id,
    player_id
  from public.fantasy_team_players
  order by fantasy_team_id, created_at, player_id
)
update public.fantasy_team_players ftp
set is_captain = true
from first_players
where ftp.fantasy_team_id = first_players.fantasy_team_id
  and ftp.player_id = first_players.player_id
  and not exists (
    select 1
    from public.fantasy_team_players existing_captain
    where existing_captain.fantasy_team_id = first_players.fantasy_team_id
      and existing_captain.is_captain
  );

alter table public.fantasy_team_players
  drop constraint if exists fantasy_team_players_position_check,
  add constraint fantasy_team_players_position_check
    check (position in ('starter', 'bench'));

create unique index if not exists fantasy_team_players_one_captain
on public.fantasy_team_players (fantasy_team_id)
where is_captain;

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

create or replace function public.get_global_leaderboard()
returns table (
  user_id uuid,
  display_name text,
  team_name text,
  total_points bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    users.id as user_id,
    coalesce(
      nullif(profiles.display_name, ''),
      nullif(users.raw_user_meta_data->>'display_name', ''),
      split_part(users.email, '@', 1),
      'Player'
    ) as display_name,
    coalesce(fantasy_teams.name, 'No team yet') as team_name,
    coalesce(
      sum(
        case
          when fantasy_team_players.is_captain then player_match_stats.fantasy_points * 2
          else player_match_stats.fantasy_points
        end
      ),
      0
    )::bigint as total_points
  from auth.users
  left join public.profiles
    on profiles.id = users.id
  left join public.fantasy_teams
    on fantasy_teams.user_id = users.id
  left join public.fantasy_team_players
    on fantasy_team_players.fantasy_team_id = fantasy_teams.id
  left join public.player_match_stats
    on player_match_stats.player_id = fantasy_team_players.player_id
  group by
    users.id,
    profiles.display_name,
    users.raw_user_meta_data,
    users.email,
    fantasy_teams.name
  order by total_points desc, display_name asc;
$$;

grant execute on function public.get_global_leaderboard() to authenticated;

create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from auth.users
  where id = auth.uid();
end;
$$;

revoke all on function public.delete_current_user() from public;
grant execute on function public.delete_current_user() to authenticated;

create or replace function public.email_is_registered(candidate_email text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from auth.users
    where lower(email) = lower(candidate_email)
  );
$$;

revoke all on function public.email_is_registered(text) from public;
grant execute on function public.email_is_registered(text) to anon, authenticated;

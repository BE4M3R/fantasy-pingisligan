begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- INSERT triggers run before ON CONFLICT resolves an existing fixture. Treat
-- that existing identity as the source, so a normal full-stage refresh may
-- update dates/statuses without changing a completed week's membership.
create or replace function private.validate_gameweek_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  source_week public.fantasy_gameweeks;
  destination_week public.fantasy_gameweeks;
  previous_kickoff timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.fantasy_gameweek_id is not distinct from old.fantasy_gameweek_id then return new; end if;
    select * into source_week from public.fantasy_gameweeks where id = old.fantasy_gameweek_id;
    previous_kickoff := old.starts_at;
  else
    select g.* into source_week from public.matches m join public.fantasy_gameweeks g on g.id = m.fantasy_gameweek_id
      where m.stupa_match_id = new.stupa_match_id;
    if source_week.id is not null and source_week.id = new.fantasy_gameweek_id then return new; end if;
    select starts_at into previous_kickoff from public.matches where stupa_match_id = new.stupa_match_id;
  end if;
  select * into destination_week from public.fantasy_gameweeks where id = new.fantasy_gameweek_id;
  if (source_week.id is not null and (source_week.data_refreshed_at is not null or private.gameweek_history_protected(source_week.id)))
    or (destination_week.id is not null and (destination_week.data_refreshed_at is not null or private.gameweek_history_protected(destination_week.id))) then
    if tg_op = 'INSERT' and source_week.id is null and destination_week.data_refreshed_at is null
      and destination_week.bucket_initialized_at is null then return new; end if;
    raise exception 'Protected fixture reassignment requires manual resolution'
      using detail = jsonb_build_object('fixture', new.stupa_match_id, 'clubs', jsonb_build_array(new.home_team_name, new.away_team_name),
        'source', source_week.name, 'destination', destination_week.name,
        'source_finished', source_week.data_refreshed_at is not null, 'destination_finished', destination_week.data_refreshed_at is not null,
        'previous_kickoff', previous_kickoff, 'new_kickoff', new.starts_at)::text;
  end if;
  return new;
end;
$$;

commit;

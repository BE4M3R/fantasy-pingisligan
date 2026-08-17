begin;

update public.fantasy_gameweeks
set
  unlock_at = (
    date_trunc(
      'day',
      last_match_ends_at at time zone 'Europe/Stockholm'
    ) + interval '1 day'
  ) at time zone 'Europe/Stockholm',
  updated_at = now();

commit;

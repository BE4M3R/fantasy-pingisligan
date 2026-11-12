begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Use calendar arithmetic in Stockholm before converting back to timestamptz,
-- so 18:00 stays 18:00 across both daylight-saving transitions.
create or replace function private.gameweek_prize_reveal_defaults()
returns table (gameweek_id uuid, prize_reveal_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with preceding as (
    select g.id, lag(g.last_match_ends_at) over (order by g.lock_at, g.id) as ends_at
    from public.fantasy_gameweeks g
  )
  select p.id,
    (((p.ends_at at time zone 'Europe/Stockholm')::date + 1) + time '18:00')
      at time zone 'Europe/Stockholm'
  from preceding p;
$$;

-- Move only future dates that still equal the old automatic unlock default.
-- Preserve custom schedules, cleared dates and already revealed competitions.
alter table public.homepage_banners disable trigger bind_competition_rules;
with preceding as (
  select g.id, lag(g.unlock_at) over (order by g.lock_at, g.id) as old_default
  from public.fantasy_gameweeks g
)
update public.homepage_banners b set prize_reveal_at = d.prize_reveal_at
from preceding p join private.gameweek_prize_reveal_defaults() d on d.gameweek_id = p.id
where b.gameweek_id = p.id and b.prize_reveal_at = p.old_default
  and b.prize_reveal_at > now();
alter table public.homepage_banners enable trigger bind_competition_rules;

comment on column public.homepage_banners.prize_reveal_at is
  'Public prize reveal schedule. Defaults to 18:00 Europe/Stockholm on the calendar day after the preceding Fantasy Gameweek last_match_ends_at, including non-prize rounds. Edit with an explicit timezone to move the actual reveal; NULL restores the Fantasy lifecycle gate without a fixed-date footer. content_ready is still required.';

-- A deliberately cleared date has no fixed schedule to advertise. Its reveal
-- still follows the original refresh-dependent Fantasy lifecycle.
create or replace function public.get_public_gameweek_banner_schedule()
returns table (gameweek_id uuid, prize_reveal_at timestamptz, prize_revealed boolean)
language sql stable security definer set search_path = '' as $$
  select s.gameweek_id, b.prize_reveal_at,
    case when b.prize_reveal_at is not null then b.prize_reveal_at <= now()
      else s.state <> 'upcoming' end
  from public.homepage_gameweek_states() s
  join public.competition_publication p on p.gameweek_id = s.gameweek_id and p.enabled
  left join public.homepage_banners b on b.gameweek_id = s.gameweek_id
  where public.competitions_enabled();
$$;

commit;

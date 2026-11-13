begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Promote the nearest opted-in prize round whose entry deadline is still open.
-- Selection is independent of Fantasy's current round and never reveals prizes.
drop function public.get_public_competition_promotions();
create function public.get_public_competition_promotions()
returns table (kind text, gameweek_number integer, content_available boolean,
  title text, description text, sponsor text, prize_title text, prize_value_sek numeric,
  image_path text, image_alt text, public_path text, prize_reveal_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with chosen as (
    select g.id as gameweek_id from public.fantasy_gameweeks g
    join public.competition_gameweek_routes() r on r.gameweek_id = g.id
    where g.lock_at > now() and g.data_refreshed_at is null
    order by g.lock_at, g.id limit 1
  )
  select 'gameweek', c.gameweek_number, c.content_available, c.title,
    case when not c.content_available then t.teaser end,
    c.sponsor, c.prize_title, c.prize_value_sek,
    coalesce(c.prize_image_path, c.image_path), coalesce(c.prize_image_alt, c.image_alt),
    c.public_path, case when not c.content_available and not s.prize_revealed then s.prize_reveal_at end
  from chosen w cross join lateral public.get_public_competition(w.gameweek_id) c
  left join public.get_public_gameweek_teasers() t on t.gameweek_id = w.gameweek_id
  left join public.get_public_gameweek_banner_schedule() s on s.gameweek_id = w.gameweek_id
  union all
  select 'season', c.gameweek_number, c.content_available, c.title, null::text,
    c.sponsor, c.prize_title, c.prize_value_sek,
    coalesce(c.prize_image_path, c.image_path), coalesce(c.prize_image_alt, c.image_alt),
    c.public_path, null::timestamptz
  from public.get_public_competition(null) c;
$$;
revoke all on function public.get_public_competition_promotions() from public, anon, authenticated;
grant execute on function public.get_public_competition_promotions() to anon, authenticated, service_role;
comment on function public.get_public_competition_promotions() is
  'Public start-page promotions: nearest enabled Gameweek with a future entry deadline, plus independently enabled Season. Before reveal, only public teaser/scheduling accompany the generic title; prize fields retain RLS gates.';

commit;

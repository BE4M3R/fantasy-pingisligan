begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.default_gameweek_competition_teaser(p_number integer)
returns text language sql immutable set search_path = '' as $$
  select case p_number
    when 1 then 'The first prize is waiting... 🏓'
    when 2 then 'A fresh challenge. A new reward!'
    when 3 then 'Your next winning moment could be close... ✨'
    when 4 then 'Something big is coming... 👀'
    when 5 then 'A new prize is on the horizon! 🏆'
    when 6 then 'Ready for the next challenge?'
    when 7 then 'Something special is up for grabs...'
    when 8 then 'New Gameweek. New prize. 🔥'
    when 9 then 'The next reward is waiting...'
    when 10 then 'Think you''ve got what it takes?'
    when 11 then 'Another Gameweek. Another chance to win!'
    when 12 then 'A little surprise is coming your way... 👀'
    when 13 then 'The next prize could be yours!'
    when 14 then 'Make this Gameweek one to remember! 🏆'
  end;
$$;

-- Fill only the newly covered weeks. Keep custom copy and existing GW4–13
-- choices, including any deliberately cleared teasers.
update public.competition_publication p
set teaser = private.default_gameweek_competition_teaser(s.gameweek_number)
from public.homepage_gameweek_states() s
where p.gameweek_id = s.gameweek_id and p.teaser is null
  and s.gameweek_number in (1, 2, 3, 14);

commit;

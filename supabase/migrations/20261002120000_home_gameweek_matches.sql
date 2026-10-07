-- Public fixture summaries only; raw STUPA payloads remain private.
create index if not exists matches_fantasy_gameweek_id_idx
  on public.matches (fantasy_gameweek_id);
create index if not exists stupa_submatches_match_id_idx
  on public.stupa_submatches (match_id);

create function public.get_gameweek_matches(p_gameweek_id uuid)
returns table (
  id uuid,
  stupa_match_id integer,
  home_team_name text,
  away_team_name text,
  starts_at timestamptz,
  status text,
  home_score integer,
  away_score integer,
  source_updated_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select m.id, m.stupa_match_id, m.home_team_name, m.away_team_name,
    m.starts_at, m.status,
    count(s.stupa_submatch_id) filter (
      where s.winning_team_stupa_id = m.home_team_stupa_participant_id
    )::integer,
    count(s.stupa_submatch_id) filter (
      where s.winning_team_stupa_id = m.away_team_stupa_participant_id
    )::integer,
    greatest(m.source_updated_at, max(s.source_updated_at))
  from public.matches m
  left join public.stupa_submatches s
    on s.match_id = m.id and upper(s.status) = 'SCORED'
  where m.fantasy_gameweek_id = p_gameweek_id
  group by m.id
  order by m.starts_at nulls last, m.id;
$$;

revoke all on function public.get_gameweek_matches(uuid) from public;
grant execute on function public.get_gameweek_matches(uuid) to anon, authenticated, service_role;

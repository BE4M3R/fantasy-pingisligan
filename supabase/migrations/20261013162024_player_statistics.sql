-- Public sports aggregates only. Never return source payloads or manager data.
create function public.get_player_statistics_rows(p_player_id uuid default null)
returns table (
  player_id uuid, gameweek_id uuid, gameweek_name text, round_order integer,
  starts_at timestamptz, is_final boolean, fantasy_points bigint,
  singles_wins bigint, singles_losses bigint, doubles_wins bigint, doubles_losses bigint,
  singles_sets_won bigint, singles_sets_lost bigint, singles_set_points bigint
)
language sql stable security definer set search_path = ''
as $$
  with visible_weeks as (
    select g.* from public.fantasy_gameweeks g
    where public.gameweek_results_are_visible(g.first_match_starts_at)
  ), context as (
    select s.stupa_submatch_id, m.fantasy_gameweek_id,
      exists (
        select 1 from public.player_submatch_results r
        where r.stupa_submatch_id = s.stupa_submatch_id
        group by r.team_stupa_participant_id having count(*) > 1
      ) as is_doubles,
      exists (
        select 1 from public.player_submatch_results r
        where r.stupa_submatch_id = s.stupa_submatch_id
          and (r.walkover or nullif(r.raw_payload #>> '{side,walkover_reason}', '') is not null)
      ) as is_walkover
    from public.stupa_submatches s
    join public.matches m on m.id = s.match_id
    join visible_weeks g on g.id = m.fantasy_gameweek_id
    where upper(s.status) = 'SCORED'
      and (p_player_id is null or exists (
        select 1 from public.player_submatch_results r
        where r.stupa_submatch_id = s.stupa_submatch_id and r.player_id = p_player_id
      ))
  ), components as (
    select r.player_id, c.fantasy_gameweek_id, c.is_doubles, r.won,
      case when c.is_walkover then case when r.won then 3 else 0 end else r.sets_won end as sets_won,
      case when c.is_walkover then 0 else r.sets_lost end as sets_lost,
      case when c.is_doubles then 0
        when c.is_walkover then case when r.won then 3 else 0 end
        when r.won then greatest(r.sets_won - r.sets_lost, 0)
        else r.sets_won end as set_points
    from context c join public.player_submatch_results r using (stupa_submatch_id)
    where r.player_id is not null and (p_player_id is null or r.player_id = p_player_id)
  ), totals as (
    select c.player_id, c.fantasy_gameweek_id,
      count(*) filter (where not c.is_doubles and c.won) as singles_wins,
      count(*) filter (where not c.is_doubles and not c.won) as singles_losses,
      count(*) filter (where c.is_doubles and c.won) as doubles_wins,
      count(*) filter (where c.is_doubles and not c.won) as doubles_losses,
      sum(c.sets_won) filter (where not c.is_doubles) as singles_sets_won,
      sum(c.sets_lost) filter (where not c.is_doubles) as singles_sets_lost,
      sum(c.set_points) as singles_set_points
    from components c group by c.player_id, c.fantasy_gameweek_id
  ), points as (
    select s.player_id, m.fantasy_gameweek_id, sum(s.fantasy_points) as fantasy_points
    from public.player_match_stats s join public.matches m on m.id = s.match_id
    join visible_weeks g on g.id = m.fantasy_gameweek_id
    where p_player_id is null or s.player_id = p_player_id
    group by s.player_id, m.fantasy_gameweek_id
  )
  select p.id, g.id, g.name, g.round_order, g.first_match_starts_at,
    g.data_refreshed_at is not null, coalesce(pt.fantasy_points, 0),
    coalesce(t.singles_wins, 0), coalesce(t.singles_losses, 0),
    coalesce(t.doubles_wins, 0), coalesce(t.doubles_losses, 0),
    coalesce(t.singles_sets_won, 0), coalesce(t.singles_sets_lost, 0), coalesce(t.singles_set_points, 0)
  from public.players p cross join visible_weeks g
  left join totals t on t.player_id = p.id and t.fantasy_gameweek_id = g.id
  left join points pt on pt.player_id = p.id and pt.fantasy_gameweek_id = g.id
  where (p_player_id is null and p.active) or p.id = p_player_id
  order by g.first_match_starts_at desc, g.id;
$$;

create function public.get_transfer_players(p_player_id uuid default null)
returns table (
  id uuid, first_name text, last_name text, birth_year integer, price numeric,
  active boolean, clubs jsonb, total_points bigint, form numeric,
  singles_wins bigint, singles_losses bigint
)
language sql stable security invoker set search_path = ''
as $$
  with ranked as (
    select s.*, row_number() over (partition by s.player_id order by s.starts_at desc, s.gameweek_id) as recent
    from public.get_player_statistics_rows(p_player_id) s
  ), totals as (
    select r.player_id, sum(r.fantasy_points)::bigint as total_points,
      round(avg(r.fantasy_points) filter (where r.recent <= 5), 1) as form,
      sum(r.singles_wins)::bigint as singles_wins, sum(r.singles_losses)::bigint as singles_losses
    from ranked r group by r.player_id
  )
  select p.id, p.first_name, p.last_name, p.birth_year, p.price, p.active,
    case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end,
    coalesce(t.total_points, 0), t.form, coalesce(t.singles_wins, 0), coalesce(t.singles_losses, 0)
  from public.players p left join public.clubs c on c.id = p.club_id
  left join totals t on t.player_id = p.id
  where (p_player_id is null and p.active) or p.id = p_player_id
  order by p.price desc nulls last, p.id;
$$;

revoke all on function public.get_player_statistics_rows(uuid) from public;
revoke all on function public.get_transfer_players(uuid) from public;
grant execute on function public.get_player_statistics_rows(uuid) to anon, authenticated, service_role;
grant execute on function public.get_transfer_players(uuid) to anon, authenticated, service_role;

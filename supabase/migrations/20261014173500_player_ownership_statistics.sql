-- Reuse locked squads from the latest successfully completed gameweek.
-- Expose only aggregate ownership; never manager IDs or individual selections.
begin;

create function public.get_player_ownership(p_player_id uuid default null)
returns table (player_id uuid, owned_percent numeric)
language sql stable security definer set search_path = ''
as $$
  with latest_week as (
    select g.id from public.fantasy_gameweeks g
    where public.gameweek_results_are_visible(g.first_match_starts_at)
      and g.data_refreshed_at is not null and now() > g.unlock_at
    order by g.first_match_starts_at desc, g.id
    limit 1
  ), team_total as (
    select count(*) as team_count
    from public.fantasy_team_gameweek_snapshots s
    join latest_week g on g.id = s.fantasy_gameweek_id
  ), owners as (
    select s.player_id, count(*) as team_count
    from public.fantasy_team_gameweek_players s
    join latest_week g on g.id = s.fantasy_gameweek_id
    where p_player_id is null or s.player_id = p_player_id
    group by s.player_id
  )
  select p.id, round(100.0 * coalesce(o.team_count, 0) / nullif(t.team_count, 0), 1)
  from public.players p cross join team_total t
  left join owners o on o.player_id = p.id
  where (p_player_id is null and p.active) or p.id = p_player_id;
$$;

revoke all on function public.get_player_ownership(uuid) from public;
grant execute on function public.get_player_ownership(uuid) to anon, authenticated, service_role;

-- Recreate to extend the response, preserving its existing named columns.
drop function public.get_transfer_players(uuid);

create function public.get_transfer_players(p_player_id uuid default null)
returns table (
  id uuid, first_name text, last_name text, birth_year integer, price numeric,
  active boolean, clubs jsonb, total_points bigint, form numeric,
  singles_wins bigint, singles_losses bigint, owned_percent numeric
)
language sql stable security invoker set search_path = ''
as $$
  with ownership as materialized (
    select * from public.get_player_ownership(p_player_id)
  ), ranked as (
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
    coalesce(t.total_points, 0), t.form, coalesce(t.singles_wins, 0), coalesce(t.singles_losses, 0), o.owned_percent
  from public.players p left join public.clubs c on c.id = p.club_id
  left join totals t on t.player_id = p.id
  left join ownership o on o.player_id = p.id
  where (p_player_id is null and p.active) or p.id = p_player_id
  order by p.price desc nulls last, p.id;
$$;

revoke all on function public.get_transfer_players(uuid) from public;
grant execute on function public.get_transfer_players(uuid) to anon, authenticated, service_role;

commit;

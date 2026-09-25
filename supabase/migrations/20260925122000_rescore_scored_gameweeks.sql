-- Apply the revised singles, doubles and fixture-clincher rules to results
-- scored before deployment, including Gameweek 1. The scorer rebuilds every
-- player match stat and locked team's score from stored results and snapshots.
-- It does not change locked lineups or transfer history.
do $$
declare
  gameweek record;
  locked_team_count integer;
  scored_team_count integer;
begin
  for gameweek in
    select gameweeks.id
    from public.fantasy_gameweeks as gameweeks
    where exists (
      select 1
      from public.matches as matches
      join public.stupa_submatches as submatches
        on submatches.match_id = matches.id
      where matches.fantasy_gameweek_id = gameweeks.id
        and upper(submatches.status) = 'SCORED'
    )
    order by gameweeks.id
  loop
    select count(*) into locked_team_count
    from public.fantasy_team_gameweek_snapshots as snapshots
    where snapshots.fantasy_gameweek_id = gameweek.id;

    if exists (
      select 1
      from public.fantasy_team_gameweek_points as points
      where points.fantasy_gameweek_id = gameweek.id
        and not exists (
          select 1
          from public.fantasy_team_gameweek_snapshots as snapshots
          where snapshots.fantasy_gameweek_id = points.fantasy_gameweek_id
            and snapshots.fantasy_team_id = points.fantasy_team_id
        )
    ) then
      raise exception 'Cannot rescore gameweek %: a scored team has no locked snapshot', gameweek.id;
    end if;

    scored_team_count := public.calculate_fantasy_gameweek_points(gameweek.id);
    if scored_team_count <> locked_team_count then
      raise exception 'Gameweek %: rescored % teams but found % locked snapshots',
        gameweek.id, scored_team_count, locked_team_count;
    end if;

    raise notice 'Rescored gameweek % for % locked teams', gameweek.id, scored_team_count;
  end loop;
end;
$$;

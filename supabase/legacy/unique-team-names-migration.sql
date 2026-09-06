begin;

do $$
begin
  if exists (
    select 1
    from public.fantasy_teams
    where onboarding_completed
    group by lower(btrim(name))
    having count(*) > 1
  ) then
    raise exception 'Completed fantasy teams already have duplicate names. Rename them before applying this migration.';
  end if;
end;
$$;

create unique index if not exists fantasy_teams_completed_name_unique
on public.fantasy_teams (lower(btrim(name)))
where onboarding_completed;

commit;

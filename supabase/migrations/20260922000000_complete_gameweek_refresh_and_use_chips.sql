-- Finalize a gameweek only after result persistence and scoring have succeeded.
-- Keeping this marker and chip usage in one transaction prevents transfers from
-- reopening with a locked chip that still appears unused.
create function public.complete_gameweek_refresh(
  p_gameweek_id uuid,
  p_refreshed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_refreshed_at is null then
    raise exception 'A gameweek refresh completion time is required.';
  end if;

  update public.fantasy_gameweeks
  set data_refreshed_at = p_refreshed_at,
      updated_at = p_refreshed_at
  where id = p_gameweek_id
    and unlock_at < p_refreshed_at
    and data_refreshed_at is null;

  if not found then
    return false;
  end if;

  update public.fantasy_team_chip_selections
  set used_at = p_refreshed_at
  where fantasy_gameweek_id = p_gameweek_id
    and locked_at is not null
    and used_at is null;

  return true;
end;
$$;

revoke all on function public.complete_gameweek_refresh(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.complete_gameweek_refresh(uuid, timestamptz)
to service_role;

-- Repair any round completed before the atomic completion function existed.
update public.fantasy_team_chip_selections as chip_selections
set used_at = gameweeks.data_refreshed_at
from public.fantasy_gameweeks as gameweeks
where gameweeks.id = chip_selections.fantasy_gameweek_id
  and gameweeks.data_refreshed_at is not null
  and chip_selections.locked_at is not null
  and chip_selections.used_at is null;

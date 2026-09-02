begin;

-- Keep permanent application player IDs separate from identifiers supplied by
-- SBTF/Profixio and Stupa. Historical identifiers remain resolvable after an
-- upstream license or role ID changes.
create table if not exists public.player_external_identities (
  provider text not null,
  external_id text not null,
  player_id uuid not null references public.players(id) on delete cascade,
  is_current boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (provider, external_id),
  constraint player_external_identities_provider_check
    check (provider in ('sbtf_license', 'stupa_user_role'))
);

create index if not exists player_external_identities_player_idx
on public.player_external_identities (player_id, provider);

create unique index if not exists player_external_identities_one_current
on public.player_external_identities (player_id, provider)
where is_current;

alter table public.player_external_identities enable row level security;

insert into public.player_external_identities (
  provider,
  external_id,
  player_id,
  is_current
)
select
  'sbtf_license',
  players.profixio_id,
  players.id,
  true
from public.players
where players.profixio_id is not null
on conflict (provider, external_id) do nothing;

insert into public.player_external_identities (
  provider,
  external_id,
  player_id,
  is_current
)
select
  'stupa_user_role',
  players.stupa_user_role_id::text,
  players.id,
  true
from public.players
where players.stupa_user_role_id is not null
on conflict (provider, external_id) do nothing;

-- The importer calls this only after name, birth year and club reconciliation
-- establishes that two source rows represent the same person. References move
-- to the current source record before the duplicate player row is removed.
create or replace function public.merge_player_records(
  keep_player_id uuid,
  duplicate_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep_role_id integer;
  duplicate_role_id integer;
begin
  if keep_player_id is null
    or duplicate_player_id is null
    or keep_player_id = duplicate_player_id then
    raise exception 'Choose two different player records to merge.';
  end if;

  select players.stupa_user_role_id
  into keep_role_id
  from public.players
  where players.id = keep_player_id
  for update;

  if not found then
    raise exception 'The player record to keep was not found.';
  end if;

  select players.stupa_user_role_id
  into duplicate_role_id
  from public.players
  where players.id = duplicate_player_id
  for update;

  if not found then
    raise exception 'The duplicate player record was not found.';
  end if;

  if exists (
    select 1
    from public.fantasy_team_players as duplicate_squad
    join public.fantasy_team_players as kept_squad
      on kept_squad.fantasy_team_id = duplicate_squad.fantasy_team_id
      and kept_squad.player_id = keep_player_id
    where duplicate_squad.player_id = duplicate_player_id
  ) then
    raise exception 'A fantasy team currently owns both player records.';
  end if;

  if exists (
    select 1
    from public.fantasy_team_gameweek_players as duplicate_snapshot
    join public.fantasy_team_gameweek_players as kept_snapshot
      on kept_snapshot.fantasy_team_id = duplicate_snapshot.fantasy_team_id
      and kept_snapshot.fantasy_gameweek_id =
        duplicate_snapshot.fantasy_gameweek_id
      and kept_snapshot.player_id = keep_player_id
    where duplicate_snapshot.player_id = duplicate_player_id
  ) then
    raise exception 'A locked fantasy squad contains both player records.';
  end if;

  if exists (
    select 1
    from public.player_match_stats as duplicate_stats
    join public.player_match_stats as kept_stats
      on kept_stats.match_id = duplicate_stats.match_id
      and kept_stats.player_id = keep_player_id
    where duplicate_stats.player_id = duplicate_player_id
  ) then
    raise exception 'A match contains statistics for both player records.';
  end if;

  update public.fantasy_team_players
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  update public.fantasy_team_gameweek_players
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  update public.player_match_stats
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  update public.player_submatch_results
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  -- Avoid the partial unique index when both records have a current identity
  -- for the same provider. The kept record's current identity wins.
  update public.player_external_identities as duplicate_identity
  set is_current = false
  where duplicate_identity.player_id = duplicate_player_id
    and duplicate_identity.is_current
    and exists (
      select 1
      from public.player_external_identities as kept_identity
      where kept_identity.player_id = keep_player_id
        and kept_identity.provider = duplicate_identity.provider
        and kept_identity.is_current
    );

  update public.player_external_identities
  set player_id = keep_player_id
  where player_id = duplicate_player_id;

  if keep_role_id is null and duplicate_role_id is not null then
    update public.players
    set stupa_user_role_id = null
    where id = duplicate_player_id;

    update public.players
    set stupa_user_role_id = duplicate_role_id
    where id = keep_player_id;
  end if;

  delete from public.players
  where id = duplicate_player_id;
end;
$$;

revoke all on function public.merge_player_records(uuid, uuid) from public;
grant execute on function public.merge_player_records(uuid, uuid)
to service_role;

commit;

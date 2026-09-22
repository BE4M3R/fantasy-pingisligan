-- Link the STUPA identities observed in the first 2026/27 results to the
-- existing permanent fantasy player UUIDs. Historical SBTF licenses remain
-- valid aliases, so previous imports and ownership records keep resolving.
do $identity_preflight$
begin
  -- Fresh databases receive catalogue players after migrations have run. Skip
  -- the aliases in that empty state; the catalogue import adds the same rows.
  -- A populated hosted database must contain every reviewed target player.
  if exists (select 1 from public.players) and exists (
    select 1
    from (
      values
        ('5d7bc8ee-4e19-4897-905f-e30f08761d7c'),
        ('bb13634f-4599-4f22-93e7-6977dd8d29a0'),
        ('cde479a6-aca3-4311-a04e-79091577f838')
    ) as expected(player_id)
    left join public.players as players
      on players.id = expected.player_id::uuid
    where players.id is null
  ) then
    raise exception 'A target player for the STUPA identity aliases is missing';
  end if;

  if exists (
    select 1
    from (
      values
        ('sbtf_license', '1103027', '5d7bc8ee-4e19-4897-905f-e30f08761d7c'),
        ('stupa_user_role', '33289', '5d7bc8ee-4e19-4897-905f-e30f08761d7c'),
        ('sbtf_license', '1053541', 'bb13634f-4599-4f22-93e7-6977dd8d29a0'),
        ('stupa_user_role', '22393', 'bb13634f-4599-4f22-93e7-6977dd8d29a0'),
        ('sbtf_license', '1027359', 'cde479a6-aca3-4311-a04e-79091577f838'),
        ('stupa_user_role', '22391', 'cde479a6-aca3-4311-a04e-79091577f838')
    ) as expected(provider, external_id, player_id)
    join public.player_external_identities as existing
      on existing.provider = expected.provider
      and existing.external_id = expected.external_id
    where existing.player_id <> expected.player_id::uuid
  ) then
    raise exception 'A STUPA identity alias belongs to a different player UUID';
  end if;
end;
$identity_preflight$;

insert into public.player_external_identities (
  provider,
  external_id,
  player_id,
  is_current
)
select
  expected.provider,
  expected.external_id,
  expected.player_id,
  false
from (
  values
    ('sbtf_license', '1103027', '5d7bc8ee-4e19-4897-905f-e30f08761d7c'::uuid),
    ('stupa_user_role', '33289', '5d7bc8ee-4e19-4897-905f-e30f08761d7c'::uuid),
    ('sbtf_license', '1053541', 'bb13634f-4599-4f22-93e7-6977dd8d29a0'::uuid),
    ('stupa_user_role', '22393', 'bb13634f-4599-4f22-93e7-6977dd8d29a0'::uuid),
    ('sbtf_license', '1027359', 'cde479a6-aca3-4311-a04e-79091577f838'::uuid),
    ('stupa_user_role', '22391', 'cde479a6-aca3-4311-a04e-79091577f838'::uuid)
) as expected(provider, external_id, player_id)
join public.players as players on players.id = expected.player_id
on conflict (provider, external_id) do nothing;

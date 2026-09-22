-- Link the STUPA identities observed in the first 2026/27 results to the
-- existing permanent fantasy player UUIDs. Historical SBTF licenses remain
-- valid aliases, so previous imports and ownership records keep resolving.
do $identity_preflight$
begin
  -- Fresh databases receive catalogue players after migrations have run. Skip
  -- the aliases in that empty state; the catalogue import adds the same rows.
  -- Hosted environments may still have legacy UUIDs, so resolve each target
  -- through its unique existing SBTF licence and verify the expected name.
  if exists (select 1 from public.players) and (
    select count(*)
    from (
      values
        ('1061624', 'Khai', 'Lam'),
        ('983359', 'Dominykas', 'Samuolis'),
        ('961725', 'Gabrielius', 'Camara')
    ) as expected(sbtf_license, first_name, last_name)
    join public.players as players
      on players.profixio_id = expected.sbtf_license
      and players.first_name = expected.first_name
      and players.last_name = expected.last_name
  ) <> 3 then
    raise exception 'A target player for the STUPA identity aliases is missing or unexpected';
  end if;

  if exists (
    select 1
    from (
      values
        ('sbtf_license', '1103027', '1061624'),
        ('stupa_user_role', '33289', '1061624'),
        ('sbtf_license', '1053541', '983359'),
        ('stupa_user_role', '22393', '983359'),
        ('sbtf_license', '1027359', '961725'),
        ('stupa_user_role', '22391', '961725')
    ) as expected(provider, external_id, anchor_license)
    join public.players as players
      on players.profixio_id = expected.anchor_license
    join public.player_external_identities as existing
      on existing.provider = expected.provider
      and existing.external_id = expected.external_id
    where existing.player_id <> players.id
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
  players.id,
  false
from (
  values
    ('sbtf_license', '1103027', '1061624'),
    ('stupa_user_role', '33289', '1061624'),
    ('sbtf_license', '1053541', '983359'),
    ('stupa_user_role', '22393', '983359'),
    ('sbtf_license', '1027359', '961725'),
    ('stupa_user_role', '22391', '961725')
) as expected(provider, external_id, anchor_license)
join public.players as players on players.profixio_id = expected.anchor_license
on conflict (provider, external_id) do nothing;

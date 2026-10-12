-- The hosted pre-baseline helper still allowed incomplete draft squads.
-- Align its two size checks with the tracked baseline: exactly 4 starters and
-- 2 bench players. This migration replaces only the function definition; it
-- never invokes it, changes grants, or rewrites stored squads/chips/history.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $reconcile$
declare
  function_id oid := 'public.save_my_fantasy_team_without_lineup_order(uuid,jsonb,text)'::regprocedure;
  original_body text;
  canonical_body text;
  definition text;
begin
  select prosrc, pg_get_functiondef(oid) into strict original_body, definition
  from pg_proc where oid = function_id;
  canonical_body := btrim(replace(original_body, E'\r\n', E'\n'), E' \t\r\n');

  -- These fingerprints cover the complete reviewed legacy/baseline bodies,
  -- including ownership, budget, player eligibility, captain and chip checks.
  -- Refuse an unreviewed third implementation instead of overwriting it.
  if md5(canonical_body) = 'f66b856c0714bc6d51a0b3e056df9cf6' then
    canonical_body := replace(canonical_body,
      'if squad_count > 6 then', 'if squad_count <> 6 then');
    canonical_body := replace(canonical_body,
      'A squad can contain at most six players.', 'A squad must contain exactly six players.');
    canonical_body := replace(canonical_body,
      'if starter_count > 4 or bench_count > 2 then', 'if starter_count <> 4 or bench_count <> 2 then');
    canonical_body := replace(canonical_body,
      'A squad can contain at most four main and two bench players.', 'Select exactly four main and two bench players.');
  end if;

  if md5(canonical_body) <> 'aea3d9c962b10bdc646cfc21abe2c9bd' then
    raise exception 'Unexpected squad-save helper definition; review remaining schema drift before deployment.';
  end if;

  if canonical_body <> original_body then
    -- Reuse live metadata to preserve the function OID, signature, security
    -- settings and ACLs. Keep the lineup wrapper and its triggers intact.
    execute replace(definition, original_body, canonical_body);
  end if;
end;
$reconcile$;

commit;

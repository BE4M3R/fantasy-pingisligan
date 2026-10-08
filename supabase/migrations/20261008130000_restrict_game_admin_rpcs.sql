-- Supabase defaults grant EXECUTE directly to API roles. Revoking PUBLIC alone
-- leaves those grants intact. These administrative functions bypass RLS and
-- must remain available only to trusted server jobs and database operators.
-- In particular, player merges can otherwise bypass squad budget validation
-- and rewrite other managers' squads and historical player references.
revoke execute on function
  public.merge_player_records(uuid, uuid),
  public.snapshot_locked_squads(),
  public.mark_used_chips(),
  public.calculate_player_match_stats(uuid),
  public.calculate_fantasy_gameweek_points(uuid)
from public, anon, authenticated;

grant execute on function
  public.merge_player_records(uuid, uuid),
  public.snapshot_locked_squads(),
  public.mark_used_chips(),
  public.calculate_player_match_stats(uuid),
  public.calculate_fantasy_gameweek_points(uuid)
to service_role;

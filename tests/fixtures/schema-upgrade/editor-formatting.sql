-- Emulate SQL-editor CRLF submissions and padding on functions reported in
-- the hosted diffs. Preserve actual SQL tokens and all function attributes.
do $$
declare
  function_row record;
begin
  for function_row in
    select oid, prosrc, pg_get_functiondef(oid) as definition
    from pg_proc where pronamespace = 'public'::regnamespace
    and proname in (
      'create_private_league', 'join_private_league', 'current_transfer_lock',
      'delete_current_user', 'email_is_registered', 'enforce_fantasy_team_club_limit',
      'enforce_transfer_refresh_lock', 'get_my_gameweek_progress',
      'get_my_played_gameweek_progress', 'mark_used_chips', 'merge_player_records',
      'preserve_team_cash_on_player_reprice', 'get_my_latest_squad_result_without_lineup_order',
      'get_my_latest_squad_set_breakdown', 'get_my_squad_result_without_lineup_order',
      'get_my_squad_set_breakdown', 'save_my_fantasy_team_without_lineup_order',
      'transfers_are_locked'
    )
  loop
    execute replace(function_row.definition, function_row.prosrc,
      E'\r\n  ' || replace(function_row.prosrc, E'\n', E'\r\n') || E'  \r\n');
  end loop;
end;
$$;

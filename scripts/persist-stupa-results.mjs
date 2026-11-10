// Production imports and the synthetic lifecycle harness share the same
// transactional result replacement. A missing RPC is a failed import, never a
// fallback to append-only writes that could double scores.
export async function persistStupaResults(supabase, submatches, playerResults, retractedSubmatches = []) {
  if (!submatches.length && !playerResults.length && !retractedSubmatches.length) {
    return { removedCount: 0, retractedGameweekIds: [] };
  }
  const { data, error } = await supabase.rpc("persist_stupa_results", {
    p_submatches: submatches,
    p_player_results: playerResults,
    p_retracted_submatches: retractedSubmatches,
  });
  if (error) throw new Error(`Could not reconcile Stupa results: ${error.message}`);
  return { removedCount: data.removed_count, retractedGameweekIds: data.retracted_gameweek_ids };
}

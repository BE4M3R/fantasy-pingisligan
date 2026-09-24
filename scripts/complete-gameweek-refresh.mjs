export async function completeOldestUnlockedGameweek(supabase, refreshedAt, { gameweekId, stageId } = {}) {
  let pending = supabase
    .from("fantasy_gameweeks")
    .select("id, name, unlock_at")
    .lt("unlock_at", refreshedAt)
    .is("data_refreshed_at", null);
  if (gameweekId) pending = pending.eq("id", gameweekId);
  if (stageId !== undefined) pending = pending.eq("stupa_stage_id", stageId);
  const { data: gameweek, error: lookupError } = await pending
    .order("unlock_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Could not check pending gameweek refreshes: ${lookupError.message}`);
  }
  if (!gameweek) {
    console.log("No unlocked gameweek is waiting for a data refresh; skipping.");
    return null;
  }

  // Score the pending gameweek even if the stage has no result rows for it.
  // A scoring failure must leave its completion marker null.
  const { error: scoringError } = await supabase.rpc("calculate_fantasy_gameweek_points", {
    target_gameweek_id: gameweek.id,
  });
  if (scoringError) throw new Error(`Could not score pending gameweek: ${scoringError.message}`);

  const { data: completed, error: completionError } = await supabase.rpc(
    "complete_gameweek_refresh",
    {
      p_gameweek_id: gameweek.id,
      p_refreshed_at: refreshedAt,
    },
  );

  if (completionError) {
    throw new Error(`Could not complete gameweek refresh: ${completionError.message}`);
  }
  if (!completed) {
    throw new Error(`${gameweek.name} was already completed by another process.`);
  }

  console.log(
    `Completed ${gameweek.name} without changing player prices; its refresh lock is cleared.`,
  );
  return gameweek;
}

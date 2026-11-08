import "server-only";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";

// The database owns this switch so direct API/table/storage access shares the
// same boundary. Missing configuration or a failed read always disables it.
// Request memoization avoids duplicate reads; no persistent launch-state cache.
export const competitionsEnabled = cache(async () => {
  const { data, error } = await createPublicClient({ fresh: true }).rpc("competitions_enabled");
  return !error && data === true;
});

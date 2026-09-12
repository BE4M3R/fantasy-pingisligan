import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { LeagueTableRow } from "@/app/dashboard/league-table";

// The baseline grants PUBLIC execute on get_global_leaderboard; it contains
// only global standings. Private league RPCs must never use this cache.
const readGlobalLeaderboard = unstable_cache(async (url: string, key: string) => {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows: LeagueTableRow[] = [];
  const batchSize = 500;
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase.rpc("get_global_leaderboard")
      .range(offset, offset + batchSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as LeagueTableRow[];
    rows.push(...batch);
    if (batch.length < batchSize) break;
  }
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}, ["global-standings-v1"], { revalidate: 60, tags: ["global-standings"] });

export async function getGlobalLeaderboard() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  try {
    return { data: await readGlobalLeaderboard(url, key), error: null };
  } catch {
    return { data: [], error: { message: "Standings could not be loaded." } };
  }
}

export function initialGlobalRows(rows: LeagueTableRow[], userId: string) {
  const firstPage = rows.slice(0, 10);
  const ownRow = rows.find((row) => row.user_id === userId);
  if (ownRow && !firstPage.some((row) => row.user_id === userId)) firstPage.push(ownRow);
  return firstPage;
}

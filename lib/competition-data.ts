import "server-only";
import { competitionsEnabled } from "@/lib/competition-publication";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import type { Competition, CompetitionStandings } from "./competitions";

// Embargoed metadata must not enter a persistent app cache.
// React cache deduplicates the page/metadata read within the current request.
export const getCompetition = cache(async (gameweekId: string | null) => {
  if (!await competitionsEnabled()) return { competition: null, error: false };
  const { data, error } = await createPublicClient({ fresh: true }).rpc("get_public_competition", {
    p_gameweek_id: gameweekId,
  });
  return { competition: (data?.[0] ?? null) as Competition | null, error: Boolean(error) };
});

export const resolveCompetitionGameweek = cache(async (number: string) => {
  if (!/^[1-9][0-9]*$/.test(number) || Number(number) > 2147483647) return null;
  const { data, error } = await createPublicClient({ fresh: true }).rpc("competition_gameweek_routes")
    .eq("gameweek_number", Number(number)).limit(2);
  if (error) throw new Error("Competition could not be loaded. Please try again.");
  return data?.length === 1 ? data[0].gameweek_id as string : null;
});

// Offset and limit use the existing scoring RPC; no ranking is recalculated here.
export async function getCompetitionStandings(gameweekId: string, offset = 0, limit = 25, search = "") {
  const { data, error } = await createPublicClient({ fresh: true }).rpc("get_competition_standings", {
    p_gameweek_id: gameweekId, p_offset: offset, p_limit: limit, p_search: search,
  });
  return error ? null : data as CompetitionStandings | null;
}

export async function getCompetitionArtwork(competition: Competition) {
  const paths = competition.prize_image_path ? [competition.prize_image_path] : [];
  if (!paths.length) return {} as Record<string, string | undefined>;
  const { data } = await createPublicClient({ fresh: true }).storage.from("announcement-artwork").createSignedUrls(paths, 300);
  return Object.fromEntries((data ?? []).map((item) => [item.path, item.signedUrl])) as Record<string, string | undefined>;
}

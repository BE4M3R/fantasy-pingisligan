import "server-only";
import streams from "@/data/match-streams.json";
import { getClub } from "@/lib/clubs";
import { safeStreamUrl, type MatchSummary } from "@/lib/match-summary";
import { createPublicClient } from "@/lib/supabase/public";

export async function getHomeMatches(gameweekId: string) {
  const { data, error } = await createPublicClient().rpc("get_gameweek_matches", {
    p_gameweek_id: gameweekId,
  });
  const links: Record<string, string> = streams;
  const matches = ((data ?? []) as MatchSummary[]).map((match) => ({
    ...match,
    stream_url: safeStreamUrl(links[getClub(match.home_team_name ?? "")?.key ?? ""]),
  }));
  return { matches, error: Boolean(error), checkedAt: Date.now() };
}

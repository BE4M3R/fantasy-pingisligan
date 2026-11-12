import "server-only";

import type { LeagueTableRow } from "@/app/dashboard/league-table";
import { competitionsEnabled } from "./competition-publication";
import { getGameweekLeaderboard, getGlobalLeaderboard, initialGlobalRows } from "./leaderboard";
import { createPublicClient } from "./supabase/public";

export type StandingsMode = "global" | "gameweek";
export type StandingsWeek = { gameweek_id: string; gameweek_number: number; state: string };
export type LeagueStandings = {
  view: StandingsMode;
  gameweekId: string | null;
  rows: LeagueTableRow[];
  total: number;
  visible: boolean;
  competitionPath: string | null;
  error: string | null;
};

// Initial rendering and in-place switching use the same standings projection,
// including the manager's row outside the first five.
export async function getLeagueStandings(view: StandingsMode, userId: string, gameweekId?: string): Promise<LeagueStandings> {
  const empty: LeagueStandings = {
    view, gameweekId: gameweekId ?? null, rows: [], total: 0,
    visible: false, competitionPath: null, error: null,
  };
  if (view === "global") {
    const result = await getGlobalLeaderboard();
    return { ...empty, gameweekId: null, visible: true,
      rows: initialGlobalRows(result.data, userId, 5), total: result.data.length,
      error: result.error ? "Global standings are temporarily unavailable. Please try again." : null };
  }
  if (!gameweekId) return empty;
  const [weekly, route] = await Promise.all([
    getGameweekLeaderboard(gameweekId, 5),
    competitionsEnabled().then((published) => published
      ? createPublicClient({ fresh: true }).rpc("competition_gameweek_routes").select("public_path")
        .eq("gameweek_id", gameweekId).maybeSingle()
      : null),
  ]);
  return { ...empty,
    rows: weekly.standings?.rows ?? [], total: weekly.standings?.total ?? 0,
    visible: weekly.standings?.visible ?? false,
    competitionPath: route?.data?.public_path ?? null,
    error: weekly.error || !weekly.standings ? "Gameweek standings are temporarily unavailable. Please try again." : null,
  };
}

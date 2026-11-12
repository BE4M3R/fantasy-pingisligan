import { getLeagueStandings, type StandingsWeek } from "@/lib/league-standings";
import { createClient } from "@/lib/supabase/server";
import { StandingsView } from "./standings-view";

export async function StandingsPanel({ userId, view, gameweek, basePath = "/dashboard/leagues" }: {
  userId: string; view?: string; gameweek?: string; basePath?: string;
}) {
  const gameweekMode = view === "gameweek";
  // Signed-in round metadata is available even before prize competitions launch.
  const supabase = await createClient();
  const [weeksResult, global] = await Promise.all([
    supabase.rpc("homepage_gameweek_states").order("lock_at", { ascending: false }),
    gameweekMode ? null : getLeagueStandings("global", userId),
  ]);
  const weeks = (weeksResult.data ?? []) as StandingsWeek[];
  const selected = weeks.find((week) => week.gameweek_id === gameweek)
    ?? weeks.find((week) => ["live", "refreshing", "previous"].includes(week.state))
    ?? weeks.at(-1);
  const initial = global ?? await getLeagueStandings("gameweek", userId, selected?.gameweek_id);

  return <StandingsView basePath={basePath} userId={userId} weeks={weeks}
    selectedId={selected?.gameweek_id}
    initial={gameweekMode && weeksResult.error ? { ...initial, error: "Gameweeks are temporarily unavailable. Please reload to try again." } : initial}
    weeksError={Boolean(weeksResult.error)} />;
}

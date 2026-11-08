import { competitionsEnabled } from "@/lib/competition-publication";
import Link from "next/link";
import { LeagueTable } from "@/app/dashboard/league-table";
import { getGameweekLeaderboard, getGlobalLeaderboard, initialGlobalRows } from "@/lib/leaderboard";
import { createPublicClient } from "@/lib/supabase/public";
import { StandingsView } from "./standings-view";

type Week = { gameweek_id: string; gameweek_number: number; state: string };

export async function StandingsPanel({ userId, view, gameweek, basePath = "/dashboard/leagues" }: {
  userId: string; view?: string; gameweek?: string; basePath?: string;
}) {
  if (!await competitionsEnabled()) {
    const global = await getGlobalLeaderboard();
    return <>
      <h2 className="text-xl font-black tracking-tight text-[var(--pf-text)]">Global league</h2>
      {global.error ? <p role="status" className="mt-4 text-sm text-[var(--pf-text-muted)]">Global standings are temporarily unavailable. Please try again.</p>
        : <LeagueTable currentUserId={userId} initialRowCount={10} rows={initialGlobalRows(global.data, userId)} searchable totalRowCount={global.data.length} />}
    </>;
  }
  const gameweekMode = view === "gameweek";
  // Only public lifecycle metadata. No sponsor content, profiles or locked squads.
  const [weeksResult, globalResult] = await Promise.all([
    createPublicClient({ fresh: true }).rpc("homepage_gameweek_states").order("lock_at", { ascending: false }),
    gameweekMode ? null : getGlobalLeaderboard(),
  ]);
  const weeks = (weeksResult.data ?? []) as Week[];
  const selected = weeks.find((week) => week.gameweek_id === gameweek)
    ?? weeks.find((week) => ["live", "refreshing", "previous"].includes(week.state))
    ?? weeks.at(-1);
  const [weekly, route] = gameweekMode && selected ? await Promise.all([
    getGameweekLeaderboard(selected.gameweek_id),
    createPublicClient({ fresh: true }).rpc("competition_gameweek_routes").select("public_path")
      .eq("gameweek_id", selected.gameweek_id).maybeSingle(),
  ]) : [null, null];
  const standings = weekly?.standings;

  return <>
    <h2 className="mb-4 text-xl font-black tracking-tight text-[var(--pf-text)]">Global league</h2>
    <StandingsView basePath={basePath} gameweekMode={gameweekMode} weeks={weeks} selectedId={selected?.gameweek_id} />
    <div>
      {gameweekMode ? weeksResult.error ? <p role="status" className="mt-4 text-sm text-[var(--pf-text-muted)]">Gameweeks are temporarily unavailable. Please try again.</p>
        : selected ? <>
          {weekly?.error || !standings ? <p role="status" className="mt-4 text-sm text-[var(--pf-text-muted)]">Gameweek standings are temporarily unavailable. Please try again.</p>
            : !standings.visible ? <p className="mt-4 text-sm leading-6 text-[var(--pf-text-muted)]">This Gameweek has not started. Standings will appear after the first match begins and squad points have been calculated.</p>
            : <LeagueTable key={selected.gameweek_id} currentUserId={userId} gameweekId={selected.gameweek_id}
                initialRowCount={10} rows={standings.rows} totalRowCount={standings.total} searchable
                emptyMessage="No scored squads yet. Check back after Gameweek results are refreshed." />}
          <Link className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--pf-brand-blue-hover)] underline underline-offset-2" href={route?.data?.public_path ?? `/competitions/gameweek/${selected.gameweek_id}`}>View this Weekly Smash competition →</Link>
        </> : <p className="mt-4 text-sm text-[var(--pf-text-muted)]">No Gameweeks are available yet.</p>
        : globalResult?.error ? <p role="status" className="mt-4 text-sm text-[var(--pf-text-muted)]">Global standings are temporarily unavailable. Please try again.</p>
        : <LeagueTable key="global" currentUserId={userId} initialRowCount={10} rows={initialGlobalRows(globalResult?.data ?? [], userId)} searchable totalRowCount={globalResult?.data.length ?? 0} />}
    </div>
  </>;
}

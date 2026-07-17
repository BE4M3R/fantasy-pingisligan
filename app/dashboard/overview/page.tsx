import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import type { LeaderboardRow } from "@/app/dashboard/leaderboard-table";
import { createClient } from "@/lib/supabase/server";

const STARTER_SIZE = 4;
const BENCH_SIZE = 2;
const SQUAD_SIZE = STARTER_SIZE + BENCH_SIZE;
const DEFAULT_BUDGET = 100000000;
const STUPA_RESULTS_URL =
  "https://sbtfeventsott.stupaevents.com/events/417/1118/0/1/1";

type FantasyTeam = {
  id: string;
  name: string;
  budget: number | string;
};

type PlayerSummary = {
  first_name: string;
  last_name: string;
  price: number | string;
};

type SquadRow = {
  is_captain: boolean;
  position: "starter" | "bench";
  players: PlayerSummary | PlayerSummary[] | null;
};

type TransferLock = {
  is_locked: boolean;
  unlock_at: string | null;
};

type ProgressRow = {
  gameweek_name: string;
  lock_at: string;
  points: number | string;
  status: string;
};

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
}

function formatPoints(value: number | string) {
  return new Intl.NumberFormat("sv-SE").format(Number(value));
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));
}

function getPlayer(row: SquadRow) {
  return Array.isArray(row.players) ? row.players[0] : row.players;
}

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

export default async function OverviewPage() {
  const supabase = await createClient();
  const { data: claimsResult } = await supabase.auth.getClaims();
  const userId = claimsResult?.claims?.sub;

  if (!userId) {
    redirect("/login");
  }

  const { data: existingTeam } = await supabase
    .from("fantasy_teams")
    .select("id, name, budget")
    .eq("user_id", userId)
    .maybeSingle();

  let fantasyTeam = existingTeam as FantasyTeam | null;

  if (!fantasyTeam) {
    const { data: createdTeam } = await supabase
      .from("fantasy_teams")
      .insert({
        user_id: userId,
        name: "My team",
        budget: DEFAULT_BUDGET,
      })
      .select("id, name, budget")
      .single();

    fantasyTeam = createdTeam as FantasyTeam | null;
  }

  const [squadResult, transferLockResult, progressResult, leaderboardResult] =
    await Promise.all([
      fantasyTeam
        ? supabase
            .from("fantasy_team_players")
            .select("position, is_captain, players(first_name, last_name, price)")
            .eq("fantasy_team_id", fantasyTeam.id)
        : Promise.resolve({ data: [] }),
      supabase.rpc("current_transfer_lock"),
      supabase.rpc("get_my_gameweek_progress"),
      supabase.rpc("get_global_leaderboard"),
    ]);

  const squad = (squadResult.data ?? []) as SquadRow[];
  const progress = (progressResult.data ?? []) as ProgressRow[];
  const leaderboard = (leaderboardResult.data ?? []) as LeaderboardRow[];
  const transferLockRows = transferLockResult.data;
  const transferLock = (
    Array.isArray(transferLockRows) ? transferLockRows[0] : transferLockRows
  ) as TransferLock | null;
  const transfersLocked = Boolean(transferLock?.is_locked);
  const captain = squad.find((row) => row.is_captain);
  const captainPlayer = captain ? getPlayer(captain) : null;
  const usedBudget = squad.reduce(
    (total, row) => total + Number(getPlayer(row)?.price ?? 0),
    0,
  );
  const remainingBudget = Number(fantasyTeam?.budget ?? DEFAULT_BUDGET) - usedBudget;
  const totalPoints = progress.reduce(
    (total, row) => total + Number(row.points),
    0,
  );
  const latestRound =
    progress.find((row) => row.status === "In progress") ??
    [...progress].reverse().find((row) => row.status === "Complete");
  const upcomingGameweek = progress.find((row) => row.status === "Upcoming");
  const rankIndex = leaderboard.findIndex((row) => row.user_id === userId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const isSquadReady = squad.length === SQUAD_SIZE;
  const squadCompletion = Math.round((squad.length / SQUAD_SIZE) * 100);
  const squadStatusColor = isSquadReady ? "#5ee9b5" : "#ffa3a3";
  const squadCountColor = isSquadReady
    ? "rgba(223, 242, 254, 0.6)"
    : "rgba(255, 202, 202, 0.8)";
  const squadProgressColor = isSquadReady ? "#00d294" : "#ff6568";

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <DashboardHeader activeTab="overview" />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="table-panel overflow-hidden rounded-lg border p-6 sm:p-8">
            <p className="text-sm font-bold uppercase tracking-widest text-emerald-300">
              Welcome back
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
              {fantasyTeam?.name ?? "Your fantasy club"}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-sky-100/70">
              Follow your season, climb the global table, and keep your
              Pingisligan squad ready for the next round.
            </p>

            <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-white/10 bg-white/5 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sky-100/50">
                  Overall rank
                </dt>
                <dd className="mt-2 text-2xl font-black">{rank ? `#${rank}` : "—"}</dd>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sky-100/50">
                  Total points
                </dt>
                <dd className="mt-2 text-2xl font-black">{formatPoints(totalPoints)}</dd>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sky-100/50">
                  Latest round
                </dt>
                <dd className="mt-2 text-2xl font-black">
                  {latestRound ? `${formatPoints(latestRound.points)} pts` : "—"}
                </dd>
                <p className="mt-1 truncate text-xs text-sky-100/45">
                  {latestRound?.gameweek_name ?? "No results yet"}
                </p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sky-100/50">
                  Budget left
                </dt>
                <dd className="mt-2 text-2xl font-black">{formatMoney(remainingBudget)}</dd>
              </div>
            </dl>

            <div className="mt-6 rounded-md border border-white/10 bg-sky-950/35 p-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-semibold" style={{ color: squadStatusColor }}>
                  {isSquadReady ? "Squad ready" : "Squad not ready"}
                </span>
                <span style={{ color: squadCountColor }}>
                  {squad.length} / {SQUAD_SIZE} players
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    backgroundColor: squadProgressColor,
                    width: `${squadCompletion}%`,
                  }}
                />
              </div>
              <div className="mt-3 flex flex-col gap-3 border-t border-white/10 pt-3 text-xs sm:flex-row sm:items-end sm:justify-between">
                <p className="text-sky-100/55">
                  Captain: {captainPlayer
                    ? `${captainPlayer.first_name} ${captainPlayer.last_name}`
                    : "not selected"}
                </p>
                <div className="sm:text-right">
                  <p className="font-bold uppercase tracking-wide text-sky-100/45">
                    {transfersLocked ? "Transfers reopen" : "Next squad lock"}
                  </p>
                  <p className="mt-1 font-semibold text-sky-50">
                    {formatDateTime(
                      transfersLocked
                        ? transferLock?.unlock_at ?? null
                        : upcomingGameweek?.lock_at ?? null,
                    ) || "No deadline scheduled"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                className="rounded-md bg-sky-100 px-4 py-2.5 text-center text-sm font-bold text-sky-950 transition hover:bg-white"
                href="/dashboard"
              >
                Manage squad
              </Link>
              <a
                className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-sky-50 transition hover:border-white/60 hover:bg-white/10"
                href={STUPA_RESULTS_URL}
                rel="noreferrer"
                target="_blank"
              >
                Pingisligan results
                <ExternalLinkIcon />
              </a>
            </div>
          </section>

          <aside className="table-panel rounded-lg border p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-sky-200/60">
                  Global
                </p>
                <h2 className="mt-1 text-xl font-bold">Leaderboard</h2>
              </div>
              <Link
                className="text-sm font-semibold text-sky-200 hover:text-white"
                href="/dashboard/leaderboard"
              >
                View all
              </Link>
            </div>

            <ol className="mt-5 divide-y divide-white/10">
              {leaderboard.slice(0, 5).map((row, index) => (
                <li
                  className={`flex items-center gap-3 py-3 ${
                    row.user_id === userId ? "text-emerald-300" : ""
                  }`}
                  key={row.user_id}
                >
                  <span className="w-6 text-sm font-black text-sky-100/50">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {row.team_name}
                  </span>
                  <span className="text-sm font-bold">
                    {formatPoints(row.total_points)}
                  </span>
                </li>
              ))}
              {!leaderboard.length ? (
                <li className="py-5 text-sm text-sky-100/55">No ranked teams yet.</li>
              ) : null}
            </ol>

          </aside>
        </div>
      </section>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import type { LeagueTableRow } from "@/app/dashboard/league-table";
import { createClient } from "@/lib/supabase/server";

const STARTER_SIZE = 4;
const BENCH_SIZE = 2;
const SQUAD_SIZE = STARTER_SIZE + BENCH_SIZE;
const DEFAULT_BUDGET = 100000000;

type FantasyTeam = {
  id: string;
  name: string;
};

type PlayerSummary = {
  first_name: string;
  last_name: string;
};

type SquadRow = {
  is_captain: boolean;
  position: "starter" | "bench";
  players: PlayerSummary | PlayerSummary[] | null;
};

type TransferLock = {
  is_locked: boolean;
  is_refreshing: boolean;
  unlock_at: string | null;
};

type ProgressRow = {
  gameweek_name: string;
  round_order: number | null;
  lock_at: string;
  points: number | string;
  status: string;
};

function formatPoints(value: number | string) {
  return new Intl.NumberFormat("sv-SE").format(Number(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "";

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));
}

function getPlayer(row: SquadRow) {
  return Array.isArray(row.players) ? row.players[0] : row.players;
}

export default async function OverviewPage() {
  const supabase = await createClient();
  const { data: claimsResult } = await supabase.auth.getClaims();
  const userId = claimsResult?.claims?.sub;

  if (!userId) redirect("/login");

  const { data: existingTeam } = await supabase
    .from("fantasy_teams")
    .select("id, name")
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
      .select("id, name")
      .single();

    fantasyTeam = createdTeam as FantasyTeam | null;
  }

  const [squadResult, transferLockResult, progressResult, leagueTableResult] =
    await Promise.all([
      fantasyTeam
        ? supabase
            .from("fantasy_team_players")
            .select("position, is_captain, players(first_name, last_name)")
            .eq("fantasy_team_id", fantasyTeam.id)
        : Promise.resolve({ data: [] }),
      supabase.rpc("current_transfer_lock"),
      supabase.rpc("get_my_gameweek_progress"),
      supabase.rpc("get_global_leaderboard"),
    ]);

  const squad = (squadResult.data ?? []) as SquadRow[];
  const progress = (progressResult.data ?? []) as ProgressRow[];
  const leagueTable = (leagueTableResult.data ?? []) as LeagueTableRow[];
  const transferLockRows = transferLockResult.data;
  const transferLock = (
    Array.isArray(transferLockRows) ? transferLockRows[0] : transferLockRows
  ) as TransferLock | null;
  const transfersLocked = Boolean(transferLock?.is_locked);
  const waitingForDataRefresh = Boolean(transferLock?.is_refreshing);
  const captain = squad.find((row) => row.is_captain);
  const captainPlayer = captain ? getPlayer(captain) : null;
  const totalPoints = progress.reduce(
    (total, row) => total + Number(row.points),
    0,
  );
  const latestRound =
    progress.find((row) => row.status === "In progress") ??
    [...progress].reverse().find((row) => row.status === "Complete");
  const upcomingGameweek = progress.find((row) => row.status === "Upcoming");
  const activeGameweek =
    progress.find((row) => row.status === "In progress") ??
    upcomingGameweek ??
    [...progress].reverse().find((row) => row.status === "Complete");
  const rankIndex = leagueTable.findIndex((row) => row.user_id === userId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const isSquadReady = squad.length === SQUAD_SIZE;
  const hasPositiveSquadStatus = transfersLocked || isSquadReady;
  const remainingPlayers = Math.max(SQUAD_SIZE - squad.length, 0);
  const squadCompletion = Math.min(
    Math.round((squad.length / SQUAD_SIZE) * 100),
    100,
  );
  const deadlineLabel = waitingForDataRefresh
    ? "Gameweek data"
    : transfersLocked
      ? "Earliest reopening"
      : "Transfer window closes";
  const deadline = waitingForDataRefresh
    ? "Updating results and prices..."
    : formatDateTime(
        transfersLocked
          ? transferLock?.unlock_at ?? null
          : upcomingGameweek?.lock_at ?? null,
      );

  return (
    <main className="dashboard-shell table-tennis-surface min-h-screen text-white">
      <DashboardHeader />

      <section className="mx-auto max-w-3xl px-4 pb-5 pt-3 sm:px-6 sm:py-8">
        <div>
          <div className="space-y-3 sm:space-y-5">
            <section className="table-panel overflow-hidden rounded-lg border p-3.5 sm:p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--pf-brand-blue)] sm:text-xs">
                Welcome back
              </p>
              <h1 className="mt-1.5 break-words text-3xl font-black leading-tight tracking-tight sm:text-4xl">
                {fantasyTeam?.name ?? "Your fantasy club"}
              </h1>
              <div
                aria-hidden="true"
                className="mx-auto mt-3 h-px w-12 bg-sky-100/20"
              />
              <p className="mt-2 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-sky-100/65 sm:text-xs">
                {activeGameweek?.round_order
                  ? `Gameweek ${activeGameweek.round_order}`
                  : activeGameweek?.gameweek_name ?? "Gameweek —"}
              </p>
              <div className="mt-1 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 text-xs">
                <p className="font-semibold text-sky-100/55">
                  {deadlineLabel}
                </p>
                <p className="font-bold text-sky-50/85">
                  {deadline || "No deadline scheduled"}
                </p>
              </div>
            </section>

            <dl className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="table-panel min-w-0 rounded-lg border px-2.5 py-2.5 sm:flex sm:items-baseline sm:justify-between sm:gap-2 sm:px-3.5 sm:py-3">
                <dt className="truncate text-[9px] font-semibold uppercase tracking-wide text-sky-100/50 min-[380px]:text-[10px] sm:text-[11px]">
                  Overall rank
                </dt>
                <dd
                  className={`mt-1 truncate text-lg font-black leading-none sm:mt-0 sm:text-xl ${
                    rank
                      ? "text-[var(--pf-fantasy-yellow)]"
                      : "text-sky-100/45"
                  }`}
                >
                  {rank ? `#${rank}` : "—"}
                </dd>
              </div>
              <div className="table-panel min-w-0 rounded-lg border px-2.5 py-2.5 sm:flex sm:items-baseline sm:justify-between sm:gap-2 sm:px-3.5 sm:py-3">
                <dt className="truncate text-[9px] font-semibold uppercase tracking-wide text-sky-100/50 min-[380px]:text-[10px] sm:text-[11px]">
                  Total points
                </dt>
                <dd className="mt-1 truncate text-lg font-black leading-none sm:mt-0 sm:text-xl">
                  {formatPoints(totalPoints)}
                </dd>
              </div>
              <div className="table-panel min-w-0 rounded-lg border px-2.5 py-2.5 sm:flex sm:items-baseline sm:justify-between sm:gap-2 sm:px-3.5 sm:py-3">
                <dt className="truncate text-[9px] font-semibold uppercase tracking-wide text-sky-100/50 min-[380px]:text-[10px] sm:text-[11px]">
                  Latest round
                </dt>
                <dd
                  className={`mt-1 truncate leading-none sm:mt-0 ${
                    latestRound
                      ? "text-lg font-black text-sky-50 sm:text-xl"
                      : "text-[10px] font-semibold text-sky-100/55 sm:text-xs"
                  }`}
                  title={latestRound?.gameweek_name}
                >
                  {latestRound
                    ? `${formatPoints(latestRound.points)} pts`
                    : "Not started"}
                </dd>
              </div>
            </dl>

            <Link
              className="table-panel group flex min-h-16 items-center justify-between gap-4 rounded-lg border px-4 py-3 transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] sm:px-5 sm:py-4"
              href="/dashboard/progress"
            >
              <span>
                <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--pf-brand-blue)]">
                  Season performance
                </span>
                <span className="mt-0.5 block text-lg font-black text-[var(--pf-text)]">
                  Follow your progress
                </span>
              </span>
              <span
                aria-hidden="true"
                className="text-2xl font-black text-[var(--pf-brand-blue-hover)] transition group-hover:translate-x-1"
              >
                →
              </span>
            </Link>

            <section
              className={`overflow-hidden rounded-lg border bg-[var(--pf-navy)] p-3.5 sm:p-5 ${
                hasPositiveSquadStatus
                  ? "border-[var(--pf-brand-blue-border)]"
                  : "border-[var(--pf-coral)]"
              }`}
            >
              <div className="flex flex-col items-start gap-1.5 min-[390px]:flex-row min-[390px]:justify-between min-[390px]:gap-3">
                <div className="min-w-0">
                  <p
                    className={`text-xs font-bold uppercase tracking-[0.16em] ${
                      hasPositiveSquadStatus
                        ? "text-[var(--pf-brand-blue)]"
                        : "text-[var(--pf-coral)]"
                    }`}
                  >
                    {hasPositiveSquadStatus ? "Squad status" : "Action needed"}
                  </p>
                  <h2 className="mt-0.5 text-xl font-black leading-tight sm:text-2xl">
                    {transfersLocked
                      ? "Squad is locked"
                      : isSquadReady
                        ? "Fantasy team ready"
                        : "Complete your squad"}
                  </h2>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${
                    hasPositiveSquadStatus
                      ? "border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] text-[var(--pf-brand-blue-hover)]"
                      : "border-[var(--pf-coral)] bg-[var(--pf-coral-soft)] text-[var(--pf-coral-text)]"
                  }`}
                >
                  {squad.length} / {SQUAD_SIZE} players
                </span>
              </div>

              {!isSquadReady && (
                <p className="mt-1.5 text-sm text-sky-50/70">
                  {remainingPlayers}{" "}
                  {remainingPlayers === 1 ? "player" : "players"} remaining
                </p>
              )}
              <div
                aria-label={`${squad.length} of ${SQUAD_SIZE} squad places filled`}
                aria-valuemax={SQUAD_SIZE}
                aria-valuemin={0}
                aria-valuenow={squad.length}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--pf-navy-elevated)]"
                role="progressbar"
              >
                <div
                  className={`h-full rounded-full transition-all ${
                    hasPositiveSquadStatus
                      ? "bg-[var(--pf-brand-blue)]"
                      : "bg-[var(--pf-coral)]"
                  }`}
                  style={{ width: `${squadCompletion}%` }}
                />
              </div>

              <div className="mt-2.5 flex items-baseline gap-2">
                <p className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-sky-100/45">
                  Captain
                </p>
                <p className="min-w-0 truncate text-sm font-semibold text-sky-50">
                  {captainPlayer
                    ? `${captainPlayer.first_name} ${captainPlayer.last_name}`
                    : "Not selected"}
                </p>
              </div>

              <Link
                className={`mt-3 flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2.5 text-center text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)] ${
                  hasPositiveSquadStatus
                    ? "bg-[var(--pf-brand-blue)] text-[var(--pf-navy-deep)] hover:bg-[var(--pf-brand-blue-hover)]"
                    : "bg-[var(--pf-coral)] text-[var(--pf-navy-deep)] hover:bg-[var(--pf-coral-hover)]"
                }`}
                href="/dashboard"
              >
                {transfersLocked
                  ? "See locked squad"
                  : isSquadReady
                    ? "Manage squad"
                    : "Complete squad"}
              </Link>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}

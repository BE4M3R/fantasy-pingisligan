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

  if (!userId) redirect("/login");

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
  const remainingBudget =
    Number(fantasyTeam?.budget ?? DEFAULT_BUDGET) - usedBudget;
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
  const miniLeaderboard = leaderboard
    .slice(0, 5)
    .map((row, index) => ({ rank: index + 1, row }));

  const isSquadReady = squad.length === SQUAD_SIZE;
  const remainingPlayers = Math.max(SQUAD_SIZE - squad.length, 0);
  const squadCompletion = Math.min(
    Math.round((squad.length / SQUAD_SIZE) * 100),
    100,
  );
  const deadlineLabel = transfersLocked
    ? "Transfer window reopens"
    : "Transfer window closes";
  const deadline = formatDateTime(
    transfersLocked
      ? transferLock?.unlock_at ?? null
      : upcomingGameweek?.lock_at ?? null,
  );

  return (
    <main className="dashboard-shell table-tennis-surface min-h-screen text-white">
      <DashboardHeader />

      <section className="mx-auto max-w-6xl px-4 pb-5 pt-3 sm:px-6 sm:py-8">
        <div className="grid gap-3 lg:grid-cols-[1.35fr_0.65fr] lg:gap-6">
          <div className="space-y-3 sm:space-y-5">
            <section className="table-panel overflow-hidden rounded-lg border p-3.5 sm:p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--pf-brand-blue)] sm:text-xs">
                Welcome back
              </p>
              <h1 className="mt-1.5 break-words text-3xl font-black leading-tight tracking-tight sm:text-4xl">
                {fantasyTeam?.name ?? "Your fantasy club"}
              </h1>
              <p className="mt-2 text-sm text-sky-100/60">
                Your season at a glance.
              </p>
            </section>

            <section
              className={`overflow-hidden rounded-lg border bg-[var(--pf-navy)] p-3.5 sm:p-5 ${
                isSquadReady
                  ? "border-[var(--pf-brand-blue-border)]"
                  : "border-[var(--pf-coral)]"
              }`}
            >
              <div className="flex flex-col items-start gap-1.5 min-[390px]:flex-row min-[390px]:justify-between min-[390px]:gap-3">
                <div className="min-w-0">
                  <p
                    className={`text-xs font-bold uppercase tracking-[0.16em] ${
                      isSquadReady
                        ? "text-[var(--pf-brand-blue)]"
                        : "text-[var(--pf-coral)]"
                    }`}
                  >
                    {isSquadReady ? "Squad complete" : "Action needed"}
                  </p>
                  <h2 className="mt-0.5 text-xl font-black leading-tight sm:text-2xl">
                    {isSquadReady
                      ? "Your squad is ready"
                      : "Complete your squad"}
                  </h2>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${
                    isSquadReady
                      ? "border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] text-[var(--pf-brand-blue-hover)]"
                      : "border-[var(--pf-coral)] bg-[var(--pf-coral-soft)] text-[var(--pf-coral-text)]"
                  }`}
                >
                  {squad.length} / {SQUAD_SIZE} players
                </span>
              </div>

              <p className="mt-1.5 text-sm text-sky-50/70">
                {isSquadReady
                  ? "All six player slots are filled."
                  : `${remainingPlayers} ${
                      remainingPlayers === 1 ? "player" : "players"
                    } remaining`}
              </p>
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
                    isSquadReady
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
                  isSquadReady
                    ? "bg-[var(--pf-brand-blue)] text-[var(--pf-navy-deep)] hover:bg-[var(--pf-brand-blue-hover)]"
                    : "bg-[var(--pf-coral)] text-[var(--pf-navy-deep)] hover:bg-[var(--pf-coral-hover)]"
                }`}
                href="/dashboard"
              >
                {isSquadReady ? "Manage squad" : "Complete squad"}
              </Link>
            </section>

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="table-panel flex min-h-24 flex-col justify-between rounded-lg border p-3 sm:min-h-28 sm:p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-sky-100/50">
                  Overall rank
                </dt>
                <dd
                  className={`mt-2 text-2xl font-black ${
                    rank
                      ? "text-[var(--pf-fantasy-yellow)]"
                      : "text-sky-100/45"
                  }`}
                >
                  {rank ? `#${rank}` : "—"}
                </dd>
              </div>
              <div className="table-panel flex min-h-24 flex-col justify-between rounded-lg border p-3 sm:min-h-28 sm:p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-sky-100/50">
                  Total points
                </dt>
                <dd className="mt-2 text-2xl font-black">
                  {formatPoints(totalPoints)}
                </dd>
              </div>
              <div className="table-panel flex min-h-24 flex-col justify-between rounded-lg border p-3 sm:min-h-28 sm:p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-sky-100/50">
                  Latest round
                </dt>
                <dd
                  className={`mt-2 ${
                    latestRound
                      ? "text-2xl font-black text-sky-50"
                      : "text-xs font-semibold leading-4 text-sky-100/55"
                  }`}
                >
                  {latestRound
                    ? `${formatPoints(latestRound.points)} pts`
                    : null}
                  {!latestRound ? (
                    <>
                      <span className="min-[360px]:hidden">Not started yet</span>
                      <span className="hidden min-[360px]:inline">
                        Season hasn&apos;t started
                      </span>
                    </>
                  ) : null}
                </dd>
                {latestRound ? (
                  <p className="mt-1 truncate text-xs text-sky-100/45">
                    {latestRound.gameweek_name}
                  </p>
                ) : null}
              </div>
              <div className="table-panel flex min-h-24 flex-col justify-between rounded-lg border p-3 sm:min-h-28 sm:p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-sky-100/50">
                  Budget left
                </dt>
                <dd className="mt-2 text-2xl font-black">
                  {formatMoney(remainingBudget)}
                </dd>
              </div>
            </dl>

            <section className="table-panel rounded-lg border p-3.5 sm:p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--pf-brand-blue)]">
                Next deadline
              </p>
              <div className="mt-1.5 flex flex-col gap-1 min-[390px]:flex-row min-[390px]:items-baseline min-[390px]:justify-between min-[390px]:gap-4">
                <h2 className="text-sm font-semibold text-sky-100/70">
                  {deadlineLabel}
                </h2>
                <p className="text-base font-bold text-sky-50 min-[390px]:text-right">
                  {deadline || "No deadline scheduled"}
                </p>
              </div>
            </section>

            <a
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] px-4 py-2.5 text-sm font-semibold text-[var(--pf-brand-blue)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)]"
              href={STUPA_RESULTS_URL}
              rel="noreferrer"
              target="_blank"
            >
              Pingisligan results
              <ExternalLinkIcon />
            </a>
          </div>

          <aside className="table-panel self-start rounded-lg border p-3.5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--pf-brand-blue)]">
                  Global
                </p>
                <h2 className="mt-1 text-xl font-bold">Leaderboard</h2>
              </div>
              <Link
                className="inline-flex min-h-10 items-center rounded-sm text-sm font-semibold text-[var(--pf-brand-blue)] hover:text-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                href="/dashboard/leaderboard"
              >
                View all
              </Link>
            </div>

            <ol className="mt-3 space-y-1.5 sm:mt-4 sm:space-y-2">
              {miniLeaderboard.map(({ rank: rowRank, row }) => (
                <li
                  className={`grid grid-cols-[1.5rem_minmax(0,1fr)_2.25rem_auto] items-center gap-2 rounded-md border px-2.5 py-2.5 text-sm sm:py-3 ${
                    row.user_id === userId
                      ? "border-[var(--pf-brand-blue)] bg-[var(--pf-brand-blue-soft)]"
                      : "border-transparent bg-[var(--pf-navy-elevated)]"
                  }`}
                  key={row.user_id}
                >
                  <span className="font-black text-sky-100/50">
                    {rowRank}
                  </span>
                  <span className="min-w-0 truncate font-semibold">
                    {row.team_name}
                    {row.user_id === userId ? (
                      <span className="ml-1.5 text-[10px] font-black uppercase text-[var(--pf-brand-blue-hover)]">
                        You
                      </span>
                    ) : null}
                  </span>
                  <span
                    aria-label="Rank movement not available"
                    className="text-center text-xs font-semibold text-sky-100/35"
                    title="Rank movement"
                  >
                    —
                  </span>
                  <span className="whitespace-nowrap text-right font-bold text-sky-50">
                    {formatPoints(row.total_points)} pts
                  </span>
                </li>
              ))}
              {leaderboard.length > 5 ? (
                <li
                  aria-label={`${leaderboard.length - 5} more ranked teams`}
                  className="flex justify-center py-1 text-sm font-black tracking-[0.35em] text-[var(--pf-brand-blue)]/45"
                >
                  <span aria-hidden="true">•••</span>
                </li>
              ) : null}
              {!leaderboard.length ? (
                <li className="py-5 text-sm text-sky-100/55">
                  No ranked teams yet.
                </li>
              ) : null}
            </ol>
          </aside>
        </div>
      </section>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import { getClubLogo } from "@/app/dashboard/club-logos";
import type { LeaderboardRow } from "@/app/dashboard/leaderboard-table";
import { PlayerPicker } from "@/app/dashboard/player-picker";
import type { DashboardPlayer, SquadPosition } from "@/app/dashboard/player-types";
import { SquadCardActions } from "@/app/dashboard/squad-card-actions";
import { createClient } from "@/lib/supabase/server";

const STARTER_SIZE = 4;
const BENCH_SIZE = 2;
const DEFAULT_BUDGET = 100000000;
const STUPA_RESULTS_URL =
  "https://sbtfeventsott.stupaevents.com/events/417/1118/0/1/1";
type FantasyTeam = {
  id: string;
  name: string;
  budget: number | string;
};

type SquadRow = {
  is_captain: boolean;
  player_id: string;
  position: SquadPosition;
  players: DashboardPlayer | DashboardPlayer[] | null;
};

type SquadPlayer = DashboardPlayer & {
  is_captain: boolean;
  position: SquadPosition;
};

type TransferLock = {
  is_locked: boolean;
  gameweek_name: string | null;
  lock_at: string | null;
  unlock_at: string | null;
};

type ProgressPointsRow = {
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

function getClubName(player: DashboardPlayer) {
  return Array.isArray(player.clubs)
    ? player.clubs[0]?.name
    : player.clubs?.name ?? "Free agent";
}

function getSquadPlayer(row: SquadRow) {
  const player = Array.isArray(row.players) ? row.players[0] : row.players;

  if (!player) {
    return null;
  }

  return {
    ...player,
    is_captain: row.is_captain,
    position: row.position,
  };
}

function ClubLogoBadge({ clubName, size = "md" }: { clubName: string; size?: "sm" | "md" }) {
  const logo = getClubLogo(clubName);
  const boxClass = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const imageClass = size === "sm" ? "max-h-7 max-w-7" : "max-h-9 max-w-9";

  return (
    <div
      className={`${boxClass} flex shrink-0 items-center justify-center rounded-md border border-white/10 bg-white p-1`}
    >
      {logo ? (
        <Image
          alt={logo.alt}
          className={`${imageClass} object-contain`}
          height={size === "sm" ? 28 : 36}
          src={logo.src}
          width={size === "sm" ? 28 : 36}
        />
      ) : (
        <span className="text-xs font-bold text-zinc-500">
          {clubName.slice(0, 1)}
        </span>
      )}
    </div>
  );
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

function SquadCard({
  player,
  remainingBudget,
  selectedPlayerIds,
  swapTargets,
  transfersLocked,
}: {
  player: SquadPlayer;
  remainingBudget: number;
  selectedPlayerIds: string[];
  swapTargets: SquadPlayer[];
  transfersLocked: boolean;
}) {
  return (
    <SquadCardActions
      player={player}
      remainingBudget={remainingBudget}
      selectedPlayerIds={selectedPlayerIds}
      swapTargets={swapTargets}
      transfersLocked={transfersLocked}
    >
        <div className="flex min-w-0 items-center gap-3">
          <ClubLogoBadge clubName={getClubName(player)} />
          <div className="min-w-0">
            <h3 className="truncate font-semibold">
              {player.first_name} {player.last_name}
              {player.is_captain ? (
                <span className="ml-2 rounded-sm bg-emerald-400 px-1.5 py-0.5 text-[10px] font-black uppercase text-zinc-950">
                  Captain
                </span>
              ) : null}
            </h3>
            <p className="mt-1 truncate text-sm text-sky-100/55">
              {getClubName(player)} · {formatMoney(player.price)}
            </p>
          </div>
        </div>
    </SquadCardActions>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) {
    redirect("/login");
  }

  const userId = claims.sub;

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

  const { message } = await searchParams;

  const { data: squadRows } = fantasyTeam
    ? await supabase
        .from("fantasy_team_players")
        .select(
          "player_id, position, is_captain, players(id, first_name, last_name, birth_year, price, clubs(name))",
        )
        .eq("fantasy_team_id", fantasyTeam.id)
    : { data: [] };

  const { data: transferLockRows } = await supabase.rpc("current_transfer_lock");
  const { data: progressRows } = await supabase.rpc("get_my_gameweek_progress");
  const { data: leaderboardRows } = await supabase.rpc("get_global_leaderboard");

  const transferLock = (
    Array.isArray(transferLockRows) ? transferLockRows[0] : transferLockRows
  ) as TransferLock | null;
  const transfersLocked = Boolean(transferLock?.is_locked);
  const squad = ((squadRows ?? []) as SquadRow[])
    .map(getSquadPlayer)
    .filter((player): player is SquadPlayer => Boolean(player));
  const starters = squad.filter((player) => player.position === "starter");
  const bench = squad.filter((player) => player.position === "bench");
  const captain = squad.find((player) => player.is_captain);
  const selectedPlayerIds = squad.map((player) => player.id);
  const isSquadFull = squad.length >= STARTER_SIZE + BENCH_SIZE;
  const usedBudget = squad.reduce(
    (total, player) => total + Number(player.price),
    0,
  );
  const budget = Number(fantasyTeam?.budget ?? DEFAULT_BUDGET);
  const remainingBudget = budget - usedBudget;
  const progress = (progressRows ?? []) as ProgressPointsRow[];
  const totalPoints = progress.reduce(
    (total, row) => total + Number(row.points),
    0,
  );
  const currentGameweek =
    progress.find((row) => row.status === "In progress") ??
    [...progress].reverse().find((row) => row.status === "Complete") ??
    progress.find((row) => row.status === "Upcoming");
  const upcomingGameweek = progress.find((row) => row.status === "Upcoming");
  const leaderboard = (leaderboardRows ?? []) as LeaderboardRow[];
  const rankIndex = leaderboard.findIndex((row) => row.user_id === userId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const squadSize = STARTER_SIZE + BENCH_SIZE;
  const squadCompletion = Math.round((squad.length / squadSize) * 100);

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <DashboardHeader activeTab="squad" />

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
              Follow your season, climb the global table, and manage your
              six-player Pingisligan squad.
            </p>

            <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-white/10 bg-white/5 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sky-100/50">Overall rank</dt>
                <dd className="mt-2 text-2xl font-black">{rank ? `#${rank}` : "—"}</dd>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sky-100/50">Total points</dt>
                <dd className="mt-2 text-2xl font-black">{formatPoints(totalPoints)}</dd>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-4">
                <dt className="truncate text-xs font-semibold uppercase tracking-wide text-sky-100/50">
                  {currentGameweek?.gameweek_name ?? "Gameweek"}
                </dt>
                <dd className="mt-2 text-2xl font-black">{formatPoints(currentGameweek?.points ?? 0)} pts</dd>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-sky-100/50">Budget left</dt>
                <dd className="mt-2 text-2xl font-black">{formatMoney(remainingBudget)}</dd>
              </div>
            </dl>

            <div className="mt-6 rounded-md border border-white/10 bg-sky-950/35 p-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-semibold">Squad ready</span>
                <span className="text-sky-100/60">{squad.length} / {squadSize} players</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${squadCompletion}%` }} />
              </div>
              <p className="mt-3 text-xs text-sky-100/55">
                Captain: {captain ? `${captain.first_name} ${captain.last_name}` : "not selected"}
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex items-center justify-center gap-2 rounded-md border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-sky-50 transition hover:border-white/60 hover:bg-white/10"
                href={STUPA_RESULTS_URL}
                rel="noreferrer"
                target="_blank"
              >
                Pingisligan results
                <ExternalLinkIcon />
              </a>
              <Link
                className="rounded-md bg-sky-100 px-4 py-2.5 text-center text-sm font-bold text-sky-950 transition hover:bg-white"
                href="/dashboard/leaderboard"
              >
                View full leaderboard
              </Link>
            </div>
          </section>

          <aside className="table-panel rounded-lg border p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-sky-200/60">Global</p>
                <h2 className="mt-1 text-xl font-bold">Leaderboard</h2>
              </div>
              <Link className="text-sm font-semibold text-sky-200 hover:text-white" href="/dashboard/leaderboard">
                View all
              </Link>
            </div>

            <ol className="mt-5 divide-y divide-white/10">
              {leaderboard.slice(0, 5).map((row, index) => (
                <li
                  className={`flex items-center gap-3 py-3 ${row.user_id === userId ? "text-emerald-300" : ""}`}
                  key={row.user_id}
                >
                  <span className="w-6 text-sm font-black text-sky-100/50">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.team_name}</span>
                  <span className="text-sm font-bold">{formatPoints(row.total_points)}</span>
                </li>
              ))}
              {!leaderboard.length ? (
                <li className="py-5 text-sm text-sky-100/55">No ranked teams yet.</li>
              ) : null}
            </ol>

            <p className="mt-6 border-t border-white/10 pt-5 text-xs font-bold uppercase tracking-wide text-sky-100/45">
              Team details
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-sky-100/55">Main / bench</dt>
                <dd className="mt-1 font-semibold text-sky-50">
                  {starters.length} / {STARTER_SIZE} · {bench.length} /{" "}
                  {BENCH_SIZE}
                </dd>
              </div>
              <div>
                <dt className="text-sky-100/55">Squad value</dt>
                <dd className="mt-1 font-semibold text-sky-50">
                  {formatMoney(usedBudget)}
                </dd>
              </div>
              <div>
                <dt className="text-sky-100/55">Captain</dt>
                <dd className="mt-1 font-semibold text-sky-50">
                  {captain
                    ? `${captain.first_name} ${captain.last_name}`
                    : "Not selected"}
                </dd>
              </div>
            </dl>
            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="text-xs font-bold uppercase tracking-wide text-sky-100/45">
                {transfersLocked ? "Transfers reopen" : "Next squad lock"}
              </p>
              <p className="mt-2 text-sm font-semibold text-sky-50">
                {formatDateTime(
                  transfersLocked
                    ? transferLock?.unlock_at ?? null
                    : upcomingGameweek?.lock_at ?? null,
                ) || "No deadline scheduled"}
              </p>
            </div>
          </aside>
        </div>

        {message ? (
          <div className="mt-6 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            {message}
          </div>
        ) : null}

        {transfersLocked ? (
          <div className="mt-6 rounded-md border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {transferLock?.gameweek_name ?? "This gameweek"} is locked for
            squad changes until {formatDateTime(transferLock?.unlock_at ?? null)}.
          </div>
        ) : null}

        <section className="table-panel mt-8 rounded-lg border p-6">
          <div>
            <h2 className="text-base font-bold">My squad</h2>
            <p className="mt-1 text-sm text-sky-100/60">
              Pick four main players, two bench players, and one captain.
            </p>
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div>
              <div className="mb-3 flex items-center justify-between gap-4">
                <h3 className="text-sm font-bold text-sky-100">
                  Main players
                </h3>
                <span className="text-xs font-semibold text-sky-100/55">
                  {starters.length} / {STARTER_SIZE}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {starters.map((player) => (
                    <SquadCard
                      key={player.id}
                      player={player}
                      remainingBudget={remainingBudget}
                      selectedPlayerIds={selectedPlayerIds}
                      swapTargets={isSquadFull ? bench : []}
                      transfersLocked={transfersLocked}
                    />
                  ))}
                {starters.length < STARTER_SIZE ? (
                  <PlayerPicker position="starter" remainingBudget={remainingBudget} selectedPlayerIds={selectedPlayerIds} transfersLocked={transfersLocked} />
                ) : null}
                {Array.from({ length: Math.max(0, STARTER_SIZE - starters.length - 1) }, (_, index) => (
                  <div aria-label="Empty main player slot" className="min-h-28 rounded-md border border-dashed border-white/10 bg-sky-950/20" key={`starter-empty-${index}`} />
                ))}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-4">
                <h3 className="text-sm font-bold text-sky-100">Bench</h3>
                <span className="text-xs font-semibold text-sky-100/55">
                  {bench.length} / {BENCH_SIZE}
                </span>
              </div>
              <div className="grid gap-3">
                {bench.map((player) => (
                    <SquadCard
                      key={player.id}
                      player={player}
                      remainingBudget={remainingBudget}
                      selectedPlayerIds={selectedPlayerIds}
                      swapTargets={isSquadFull ? starters : []}
                      transfersLocked={transfersLocked}
                    />
                  ))}
                {bench.length < BENCH_SIZE ? (
                  <PlayerPicker position="bench" remainingBudget={remainingBudget} selectedPlayerIds={selectedPlayerIds} transfersLocked={transfersLocked} />
                ) : null}
                {Array.from({ length: Math.max(0, BENCH_SIZE - bench.length - 1) }, (_, index) => (
                  <div aria-label="Empty bench player slot" className="min-h-28 rounded-md border border-dashed border-white/10 bg-sky-950/20" key={`bench-empty-${index}`} />
                ))}
              </div>
            </div>
          </div>
        </section>

      </section>
    </main>
  );
}

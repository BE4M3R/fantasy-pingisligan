import Image from "next/image";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import {
  ChipSelector,
  type ChipSelection,
} from "@/app/dashboard/chip-selector";
import { getClubLogo } from "@/app/dashboard/club-logos";
import { PlayerPicker } from "@/app/dashboard/player-picker";
import type { DashboardPlayer, SquadPosition } from "@/app/dashboard/player-types";
import { SquadCardActions } from "@/app/dashboard/squad-card-actions";
import { createClient } from "@/lib/supabase/server";

const STARTER_SIZE = 4;
const BENCH_SIZE = 2;
const DEFAULT_BUDGET = 100000000;

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
  unlock_at: string | null;
};

type UpcomingGameweek = {
  id: string;
  lock_at: string;
  name: string;
};

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
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

function getClubId(player: DashboardPlayer) {
  return Array.isArray(player.clubs)
    ? player.clubs[0]?.id ?? null
    : player.clubs?.id ?? null;
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

function ClubLogoBadge({ clubName }: { clubName: string }) {
  const logo = getClubLogo(clubName);

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white p-1">
      {logo ? (
        <Image
          alt={logo.alt}
          className="max-h-9 max-w-9 object-contain"
          height={36}
          src={logo.src}
          width={36}
        />
      ) : (
        <span className="text-xs font-bold text-zinc-500">
          {clubName.slice(0, 1)}
        </span>
      )}
    </div>
  );
}

function SquadCard({
  player,
  remainingBudget,
  selectedClubIds,
  selectedPlayerIds,
  swapTargets,
  transfersLocked,
}: {
  player: SquadPlayer;
  remainingBudget: number;
  selectedClubIds: string[];
  selectedPlayerIds: string[];
  swapTargets: SquadPlayer[];
  transfersLocked: boolean;
}) {
  const clubName = getClubName(player);

  return (
    <SquadCardActions
      player={player}
      remainingBudget={remainingBudget}
      selectedClubIds={selectedClubIds}
      selectedPlayerIds={selectedPlayerIds}
      swapTargets={swapTargets}
      transfersLocked={transfersLocked}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ClubLogoBadge clubName={clubName} />
        <div className="min-w-0">
          <h3 className="flex min-w-0 items-center gap-2 font-semibold">
            <span className="truncate">
              {player.first_name} {player.last_name}
            </span>
            {player.is_captain ? (
              <span
                aria-label="Captain"
                className="inline-flex shrink-0 items-center justify-center rounded-sm bg-emerald-400 px-2 py-0.5 text-sm font-black uppercase leading-none text-zinc-950 sm:px-1.5 sm:text-[10px]"
              >
                <span aria-hidden="true" className="sm:hidden">C</span>
                <span aria-hidden="true" className="hidden sm:inline">Captain</span>
              </span>
            ) : null}
          </h3>
          <p className="mt-1 truncate text-sm text-sky-100/55">
            {clubName} · {formatMoney(player.price)}
          </p>
        </div>
      </div>
    </SquadCardActions>
  );
}

export default async function SquadPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
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

  const [
    squadResult,
    transferLockResult,
    upcomingGameweekResult,
    chipSelectionsResult,
  ] = await Promise.all([
    fantasyTeam
      ? supabase
          .from("fantasy_team_players")
          .select(
            "player_id, position, is_captain, players(id, first_name, last_name, birth_year, price, clubs(id, name))",
          )
          .eq("fantasy_team_id", fantasyTeam.id)
      : Promise.resolve({ data: [] }),
    supabase.rpc("current_transfer_lock"),
    supabase
      .from("fantasy_gameweeks")
      .select("id, name, lock_at")
      .gt("lock_at", new Date().toISOString())
      .order("lock_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    fantasyTeam
      ? supabase
          .from("fantasy_team_chip_selections")
          .select("chip, fantasy_gameweek_id, locked_at, used_at")
          .eq("fantasy_team_id", fantasyTeam.id)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const { message } = await searchParams;
  const transferLockRows = transferLockResult.data;
  const transferLock = (
    Array.isArray(transferLockRows) ? transferLockRows[0] : transferLockRows
  ) as TransferLock | null;
  const transfersLocked = Boolean(transferLock?.is_locked);
  const upcomingGameweek = upcomingGameweekResult.data as UpcomingGameweek | null;
  const chipSelections = (chipSelectionsResult.data ?? []) as ChipSelection[];
  const chipMigrationMissing = Boolean(
    chipSelectionsResult.error?.message.includes("fantasy_team_chip_selections"),
  );
  const currentChipSelection = upcomingGameweek
    ? chipSelections.find(
        (selection) =>
          selection.fantasy_gameweek_id === upcomingGameweek.id &&
          !selection.locked_at,
      ) ?? null
    : null;
  const squad = ((squadResult.data ?? []) as SquadRow[])
    .map(getSquadPlayer)
    .filter((player): player is SquadPlayer => Boolean(player));
  const starters = squad.filter((player) => player.position === "starter");
  const bench = squad.filter((player) => player.position === "bench");
  const selectedClubIds = squad
    .map(getClubId)
    .filter((clubId): clubId is string => Boolean(clubId));
  const selectedPlayerIds = squad.map((player) => player.id);
  const isSquadFull = squad.length >= STARTER_SIZE + BENCH_SIZE;
  const usedBudget = squad.reduce(
    (total, player) => total + Number(player.price),
    0,
  );
  const remainingBudget =
    Number(fantasyTeam?.budget ?? DEFAULT_BUDGET) - usedBudget;

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <DashboardHeader activeTab="squad" />

      <section className="mx-auto max-w-6xl px-6 py-10">
        {message ? (
          <div className="mb-6 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            {message}
          </div>
        ) : null}

        <div
          className={`mb-6 rounded-lg border px-4 py-4 ${
            transfersLocked
              ? "border-red-300/30 text-red-100"
              : "border-emerald-300/30 text-emerald-100"
          }`}
          style={{
            backgroundColor: transfersLocked
              ? "rgba(248, 113, 113, 0.12)"
              : "rgba(52, 211, 153, 0.14)",
          }}
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                transfersLocked ? "bg-red-300" : "bg-emerald-300"
              }`}
            />
            <div>
              <p className="font-bold">
                Transfer window {transfersLocked ? "closed" : "open"}
              </p>
              <p className="mt-1 text-sm opacity-80">
                {transfersLocked
                  ? `Squad changes reopen ${formatDateTime(transferLock?.unlock_at ?? null) || "after the round finishes"}.`
                  : upcomingGameweek
                    ? `You can change your squad until ${formatDateTime(upcomingGameweek.lock_at)} before ${upcomingGameweek.name}.`
                    : "You can change your squad. No closing time is currently scheduled."}
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <ChipSelector
            currentSelection={currentChipSelection}
            migrationMissing={chipMigrationMissing}
            selections={chipSelections}
            transfersLocked={transfersLocked}
            upcomingGameweek={upcomingGameweek}
          />
        </div>

        <section className="table-panel min-w-0 rounded-lg border p-6">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">
                {fantasyTeam?.name ?? "Your fantasy team"}
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">My squad</h1>
              <p className="mt-2 text-sm text-sky-100/60">
                Pick four main players, two bench players, and one captain. Maximum two players per club.
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm sm:min-w-64">
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <dt className="text-xs text-sky-100/50">Squad value</dt>
                <dd className="mt-1 font-bold">{formatMoney(usedBudget)}</dd>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <dt className="text-xs text-sky-100/50">Budget left</dt>
                <dd className="mt-1 font-bold">{formatMoney(remainingBudget)}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-3 lg:gap-3">
            <div className="min-w-0 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between gap-4">
                <h2 className="text-sm font-bold text-sky-100">Main players</h2>
                <span className="text-xs font-semibold text-sky-100/55">
                  {starters.length} / {STARTER_SIZE}
                </span>
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
                {starters.map((player) => (
                  <SquadCard
                    key={player.id}
                    player={player}
                    remainingBudget={remainingBudget}
                    selectedClubIds={selectedClubIds}
                    selectedPlayerIds={selectedPlayerIds}
                    swapTargets={isSquadFull ? bench : []}
                    transfersLocked={transfersLocked}
                  />
                ))}
                {starters.length < STARTER_SIZE ? (
                  <PlayerPicker
                    position="starter"
                    remainingBudget={remainingBudget}
                    selectedClubIds={selectedClubIds}
                    selectedPlayerIds={selectedPlayerIds}
                    transfersLocked={transfersLocked}
                  />
                ) : null}
                {Array.from(
                  { length: Math.max(0, STARTER_SIZE - starters.length - 1) },
                  (_, index) => (
                    <div
                      aria-label="Empty main player slot"
                      className="h-28 min-w-0 rounded-md border border-dashed border-white/10 bg-sky-950/20"
                      key={`starter-empty-${index}`}
                    />
                  ),
                )}
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-4">
                <h2 className="text-sm font-bold text-sky-100">Bench</h2>
                <span className="text-xs font-semibold text-sky-100/55">
                  {bench.length} / {BENCH_SIZE}
                </span>
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
                {bench.map((player) => (
                  <SquadCard
                    key={player.id}
                    player={player}
                    remainingBudget={remainingBudget}
                    selectedClubIds={selectedClubIds}
                    selectedPlayerIds={selectedPlayerIds}
                    swapTargets={isSquadFull ? starters : []}
                    transfersLocked={transfersLocked}
                  />
                ))}
                {bench.length < BENCH_SIZE ? (
                  <PlayerPicker
                    position="bench"
                    remainingBudget={remainingBudget}
                    selectedClubIds={selectedClubIds}
                    selectedPlayerIds={selectedPlayerIds}
                    transfersLocked={transfersLocked}
                  />
                ) : null}
                {Array.from(
                  { length: Math.max(0, BENCH_SIZE - bench.length - 1) },
                  (_, index) => (
                    <div
                      aria-label="Empty bench player slot"
                      className="h-28 min-w-0 rounded-md border border-dashed border-white/10 bg-sky-950/20"
                      key={`bench-empty-${index}`}
                    />
                  ),
                )}
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

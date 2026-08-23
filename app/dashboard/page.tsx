import { redirect } from "next/navigation";
import { type ChipSelection } from "@/app/dashboard/chip-selector";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import type {
  DashboardPlayer,
  DraftSquadPlayer,
  ResultGameweek,
  SquadPosition,
} from "@/app/dashboard/player-types";
import {
  buildSquadResult,
  type SquadResultRow,
  type SquadSetBreakdownRow,
} from "@/app/dashboard/result-data";
import { SquadEditor } from "@/app/dashboard/squad-editor";
import { createClient } from "@/lib/supabase/server";

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

type TransferLock = {
  gameweek_id: string | null;
  is_locked: boolean;
  is_refreshing: boolean;
  gameweek_name: string | null;
  unlock_at: string | null;
};

type UpcomingGameweek = {
  id: string;
  lock_at: string;
  name: string;
};

type PreviousGameweek = {
  id: string;
  fantasy_team_gameweek_snapshots:
    | { free_transfers_after_lock: number | null }
    | { free_transfers_after_lock: number | null }[]
    | null;
};

type PreviousPlayer = {
  player_id: string;
};

type ResultGameweekRow = {
  fantasy_gameweek_id: string;
  fantasy_gameweeks:
    | ResultGameweek
    | ResultGameweek[]
    | null;
  transfer_penalty_points: number | string;
};

function formatDateTime(value: string | null) {
  if (!value) return "";

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));
}

function getSquadPlayer(row: SquadRow): DraftSquadPlayer | null {
  const player = Array.isArray(row.players) ? row.players[0] : row.players;

  if (!player) return null;

  return {
    ...player,
    is_captain: row.is_captain,
    position: row.position,
  };
}

function getPreviousSnapshot(row: PreviousGameweek | null) {
  if (!row) return null;

  return Array.isArray(row.fantasy_team_gameweek_snapshots)
    ? row.fantasy_team_gameweek_snapshots[0] ?? null
    : row.fantasy_team_gameweek_snapshots;
}

function getResultGameweek(row: ResultGameweekRow) {
  const gameweek = Array.isArray(row.fantasy_gameweeks)
    ? row.fantasy_gameweeks[0] ?? null
    : row.fantasy_gameweeks;

  return gameweek
    ? {
        ...gameweek,
        transferPenaltyPoints: Number(row.transfer_penalty_points),
      }
    : null;
}

function compareResultGameweeks(
  left: ResultGameweek,
  right: ResultGameweek,
) {
  if (left.round_order === null && right.round_order !== null) return -1;
  if (left.round_order !== null && right.round_order === null) return 1;

  if (
    left.round_order !== null &&
    right.round_order !== null &&
    left.round_order !== right.round_order
  ) {
    return left.round_order - right.round_order;
  }

  return (
    left.lock_at.localeCompare(right.lock_at) || left.id.localeCompare(right.id)
  );
}

export default async function SquadPage({
  searchParams,
}: {
  searchParams: Promise<{
    gameweek?: string;
    message?: string;
    view?: string;
  }>;
}) {
  const supabase = await createClient();
  const { data: claimsResult } = await supabase.auth.getClaims();
  const userId = claimsResult?.claims?.sub;

  if (!userId) redirect("/login");

  const {
    gameweek: requestedGameweekId,
    message,
    view,
  } = await searchParams;

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
    resultGameweeksResult,
    latestSquadResult,
    latestSetBreakdownResult,
  ] = await Promise.all([
    fantasyTeam
      ? supabase
          .from("fantasy_team_players")
          .select(
            "player_id, position, is_captain, players(id, first_name, last_name, birth_year, price, active, clubs(id, name))",
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
          .select("chip, fantasy_gameweek_id, locked_at")
          .eq("fantasy_team_id", fantasyTeam.id)
      : Promise.resolve({ data: [], error: null }),
    fantasyTeam
      ? supabase
          .from("fantasy_team_gameweek_snapshots")
          .select(
            "fantasy_gameweek_id, transfer_penalty_points, fantasy_gameweeks!inner(id, name, round_order, lock_at)",
          )
          .eq("fantasy_team_id", fantasyTeam.id)
      : Promise.resolve({ data: [], error: null }),
    supabase.rpc("get_my_latest_squad_result"),
    supabase.rpc("get_my_latest_squad_set_breakdown"),
  ]);

  const transferLockRows = transferLockResult.data;
  const transferLock = (
    Array.isArray(transferLockRows) ? transferLockRows[0] : transferLockRows
  ) as TransferLock | null;
  const transfersLocked = Boolean(transferLock?.is_locked);
  const waitingForDataRefresh = Boolean(transferLock?.is_refreshing);
  const upcomingGameweek =
    upcomingGameweekResult.data as UpcomingGameweek | null;
  const chipSelections = (chipSelectionsResult.data ?? []) as ChipSelection[];
  const resultGameweeks = (
    (resultGameweeksResult.data ?? []) as ResultGameweekRow[]
  )
    .map(getResultGameweek)
    .filter((gameweek): gameweek is NonNullable<typeof gameweek> =>
      Boolean(gameweek),
    )
    .sort(compareResultGameweeks);
  const latestResultGameweek = resultGameweeks.at(-1) ?? null;
  let selectedResultGameweek =
    resultGameweeks.find(({ id }) => id === requestedGameweekId) ??
    latestResultGameweek;
  let selectedSquadResult = latestSquadResult;
  let selectedSetBreakdownResult = latestSetBreakdownResult;
  let resultHistoryMigrationMissing = false;

  if (
    selectedResultGameweek &&
    latestResultGameweek &&
    selectedResultGameweek.id !== latestResultGameweek.id
  ) {
    [selectedSquadResult, selectedSetBreakdownResult] = await Promise.all([
      supabase.rpc("get_my_squad_result", {
        target_gameweek_id: selectedResultGameweek.id,
      }),
      supabase.rpc("get_my_squad_set_breakdown", {
        target_gameweek_id: selectedResultGameweek.id,
      }),
    ]);

    if (selectedSquadResult.error) {
      resultHistoryMigrationMissing = true;
      selectedResultGameweek = latestResultGameweek;
      selectedSquadResult = latestSquadResult;
      selectedSetBreakdownResult = latestSetBreakdownResult;
    }
  }

  const resultModeMigrationMissing = Boolean(selectedSquadResult.error);
  const latestResultSquad = buildSquadResult(
    (selectedSquadResult.data ?? []) as SquadResultRow[],
    (selectedSetBreakdownResult.data ?? []) as SquadSetBreakdownRow[],
  );
  const latestResultTransferPenalty =
    selectedResultGameweek?.transferPenaltyPoints ?? 0;
  const chipMigrationMissing = Boolean(
    chipSelectionsResult.error?.message.includes(
      "fantasy_team_chip_selections",
    ),
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
    .filter((player): player is DraftSquadPlayer => Boolean(player));
  let previousGameweek: PreviousGameweek | null = null;
  let previousPlayers: PreviousPlayer[] = [];
  let transferSummaryMigrationMissing = false;

  if (fantasyTeam && upcomingGameweek && !chipMigrationMissing) {
    const { data: previousGameweekRow, error: previousGameweekError } =
      await supabase
        .from("fantasy_gameweeks")
        .select(
          "id, fantasy_team_gameweek_snapshots!inner(free_transfers_after_lock)",
        )
        .eq(
          "fantasy_team_gameweek_snapshots.fantasy_team_id",
          fantasyTeam.id,
        )
        .lt("lock_at", upcomingGameweek.lock_at)
        .order("lock_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (previousGameweekError) {
      transferSummaryMigrationMissing =
        previousGameweekError.message.includes("free_transfers_after_lock");
    } else {
      previousGameweek = previousGameweekRow as PreviousGameweek | null;
    }

    if (previousGameweek?.id) {
      const { data: previousPlayerRows, error: previousPlayersError } =
        await supabase
          .from("fantasy_team_gameweek_players")
          .select("player_id")
          .eq("fantasy_team_id", fantasyTeam.id)
          .eq("fantasy_gameweek_id", previousGameweek.id);

      if (previousPlayersError) {
        transferSummaryMigrationMissing =
          previousPlayersError.message.includes(
            "fantasy_team_gameweek_players",
          );
      } else {
        previousPlayers = (previousPlayerRows ?? []) as PreviousPlayer[];
      }
    }
  }

  const previousSnapshot = getPreviousSnapshot(previousGameweek);
  const transferWindowMessage = transfersLocked
    ? waitingForDataRefresh
      ? "Updating results and player prices. Transfers reopen automatically when the refresh finishes."
      : `Transfer window opens earliest ${
          formatDateTime(transferLock?.unlock_at ?? null) ||
          "the round finishes"
        }.`
    : upcomingGameweek
      ? `Transfer window closes ${formatDateTime(upcomingGameweek.lock_at)}.`
      : "Transfer window closing time is not scheduled.";

  return (
    <main className="dashboard-shell squad-page table-tennis-surface min-h-screen text-white">
      <DashboardHeader />

      <section className="mx-auto max-w-6xl px-3 pb-8 pt-2 min-[390px]:px-4 sm:px-6 sm:py-8">
        {message ? (
          <div className="mb-6 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            {message}
          </div>
        ) : null}

        <SquadEditor
          availableTransfersAfterPreviousGameweek={
            previousSnapshot
              ? Number(previousSnapshot.free_transfers_after_lock ?? 1)
              : null
          }
          budget={fantasyTeam?.budget ?? DEFAULT_BUDGET}
          chipMigrationMissing={chipMigrationMissing}
          chipSelections={chipSelections}
          initialChip={currentChipSelection?.chip ?? null}
          initialViewMode={view === "results" ? "results" : "transfers"}
          initialSquad={squad}
          latestResultSquad={latestResultSquad}
          latestResultTransferPenalty={latestResultTransferPenalty}
          lockedGameweekId={transferLock?.gameweek_id ?? null}
          previousPlayerIds={previousPlayers.map((row) => row.player_id)}
          resultGameweeks={
            resultHistoryMigrationMissing && latestResultGameweek
              ? [latestResultGameweek]
              : resultGameweeks
          }
          resultModeMigrationMissing={resultModeMigrationMissing}
          transferWindowMessage={transferWindowMessage}
          transferSummaryMigrationMissing={transferSummaryMigrationMissing}
          transfersLocked={transfersLocked}
          upcomingGameweek={upcomingGameweek}
        />
      </section>
    </main>
  );
}

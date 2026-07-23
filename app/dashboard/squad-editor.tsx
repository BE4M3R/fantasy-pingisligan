"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  saveSquadDraft,
  type SaveSquadDraftInput,
} from "@/app/dashboard/actions";
import {
  ChipSelector,
  type Chip,
  type ChipSelection,
} from "@/app/dashboard/chip-selector";
import { getClubLogo } from "@/app/dashboard/club-logos";
import { PlayerPicker } from "@/app/dashboard/player-picker";
import type {
  DashboardPlayer,
  DraftSquadPlayer,
  SquadPosition,
} from "@/app/dashboard/player-types";
import { SquadCardActions } from "@/app/dashboard/squad-card-actions";

const STARTER_SIZE = 4;
const BENCH_SIZE = 2;
const MAX_FREE_TRANSFERS = 4;

type UpcomingGameweek = {
  id: string;
  lock_at: string;
  name: string;
};

type SquadEditorProps = {
  availableTransfersAfterPreviousGameweek: number | null;
  budget: number | string;
  chipMigrationMissing: boolean;
  chipSelections: ChipSelection[];
  initialChip: Chip | null;
  initialSquad: DraftSquadPlayer[];
  previousPlayerIds: string[];
  teamName: string;
  transferSummaryMigrationMissing: boolean;
  transfersLocked: boolean;
  upcomingGameweek: UpcomingGameweek | null;
};

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
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

function getDraftSignature(players: DraftSquadPlayer[], chip: Chip | null) {
  return JSON.stringify({
    chip,
    players: players
      .map((player) => ({
        is_captain: player.is_captain,
        player_id: player.id,
        position: player.position,
      }))
      .toSorted((left, right) => left.player_id.localeCompare(right.player_id)),
  });
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
  onMakeCaptain,
  onRemove,
  onReplace,
  onSwapPosition,
  player,
  remainingBudget,
  selectedClubIds,
  selectedPlayerIds,
  swapTargets,
  transfersLocked,
}: {
  onMakeCaptain: () => void;
  onRemove: () => void;
  onReplace: (player: DashboardPlayer) => void;
  onSwapPosition: (targetPlayerId: string) => void;
  player: DraftSquadPlayer;
  remainingBudget: number;
  selectedClubIds: string[];
  selectedPlayerIds: string[];
  swapTargets: DraftSquadPlayer[];
  transfersLocked: boolean;
}) {
  const clubName = getClubName(player);

  return (
    <SquadCardActions
      onMakeCaptain={onMakeCaptain}
      onRemove={onRemove}
      onReplace={onReplace}
      onSwapPosition={onSwapPosition}
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
                <span aria-hidden="true" className="sm:hidden">
                  C
                </span>
                <span aria-hidden="true" className="hidden sm:inline">
                  Captain
                </span>
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

export function SquadEditor({
  availableTransfersAfterPreviousGameweek,
  budget,
  chipMigrationMissing,
  chipSelections,
  initialChip,
  initialSquad,
  previousPlayerIds,
  teamName,
  transferSummaryMigrationMissing,
  transfersLocked,
  upcomingGameweek,
}: SquadEditorProps) {
  const [draftSquad, setDraftSquad] =
    useState<DraftSquadPlayer[]>(initialSquad);
  const [selectedChip, setSelectedChip] = useState<Chip | null>(initialChip);
  const [savedSquad, setSavedSquad] =
    useState<DraftSquadPlayer[]>(initialSquad);
  const [savedChip, setSavedChip] = useState<Chip | null>(initialChip);
  const [saveMessage, setSaveMessage] = useState("");
  const [isSaving, startSaving] = useTransition();
  const draftSignature = useMemo(
    () => getDraftSignature(draftSquad, selectedChip),
    [draftSquad, selectedChip],
  );
  const savedSignature = useMemo(
    () => getDraftSignature(savedSquad, savedChip),
    [savedChip, savedSquad],
  );
  const isDirty = draftSignature !== savedSignature;
  const starters = draftSquad.filter(
    (player) => player.position === "starter",
  );
  const bench = draftSquad.filter((player) => player.position === "bench");
  const selectedPlayerIds = draftSquad.map((player) => player.id);
  const selectedClubIds = draftSquad
    .map(getClubId)
    .filter((clubId): clubId is string => Boolean(clubId));
  const usedBudget = draftSquad.reduce(
    (total, player) => total + Number(player.price),
    0,
  );
  const remainingBudget = Number(budget) - usedBudget;
  const transferSummary = useMemo(() => {
    if (availableTransfersAfterPreviousGameweek === null) {
      return { penaltyPoints: 0, remainingLabel: "Unlimited" };
    }

    if (selectedChip === "wildcard") {
      return { penaltyPoints: 0, remainingLabel: "Unlimited" };
    }

    const previousIds = new Set(previousPlayerIds);
    const transferCount = selectedPlayerIds.filter(
      (playerId) => !previousIds.has(playerId),
    ).length;
    const availableTransfers = Math.min(
      availableTransfersAfterPreviousGameweek + 1,
      MAX_FREE_TRANSFERS,
    );

    return {
      penaltyPoints:
        Math.max(transferCount - availableTransfers, 0) * -4,
      remainingLabel: String(
        Math.max(availableTransfers - transferCount, 0),
      ),
    };
  }, [
    availableTransfersAfterPreviousGameweek,
    previousPlayerIds,
    selectedChip,
    selectedPlayerIds,
  ]);

  useEffect(() => {
    if (!isDirty) return;

    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", warnAboutUnsavedChanges);
    return () =>
      window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
  }, [isDirty]);

  function addPlayer(player: DashboardPlayer, position: SquadPosition) {
    setSaveMessage("");
    setDraftSquad((currentSquad) => [
      ...currentSquad,
      {
        ...player,
        is_captain: currentSquad.length === 0,
        position,
      },
    ]);
  }

  function replacePlayer(
    outgoingPlayerId: string,
    incomingPlayer: DashboardPlayer,
  ) {
    setSaveMessage("");
    setDraftSquad((currentSquad) =>
      currentSquad.map((player) =>
        player.id === outgoingPlayerId
          ? {
              ...incomingPlayer,
              is_captain: player.is_captain,
              position: player.position,
            }
          : player,
      ),
    );
  }

  function removePlayer(playerId: string) {
    setSaveMessage("");
    setDraftSquad((currentSquad) => {
      const removedPlayer = currentSquad.find(
        (player) => player.id === playerId,
      );
      const remainingPlayers = currentSquad.filter(
        (player) => player.id !== playerId,
      );

      if (removedPlayer?.is_captain && remainingPlayers.length) {
        return remainingPlayers.map((player, index) => ({
          ...player,
          is_captain: index === 0,
        }));
      }

      return remainingPlayers;
    });
  }

  function makeCaptain(playerId: string) {
    setSaveMessage("");
    setDraftSquad((currentSquad) =>
      currentSquad.map((player) => ({
        ...player,
        is_captain: player.id === playerId,
      })),
    );
  }

  function swapPositions(playerId: string, targetPlayerId: string) {
    setSaveMessage("");
    setDraftSquad((currentSquad) => {
      const player = currentSquad.find((row) => row.id === playerId);
      const targetPlayer = currentSquad.find(
        (row) => row.id === targetPlayerId,
      );

      if (!player || !targetPlayer) return currentSquad;

      return currentSquad.map((row) => {
        if (row.id === playerId) {
          return { ...row, position: targetPlayer.position };
        }
        if (row.id === targetPlayerId) {
          return { ...row, position: player.position };
        }
        return row;
      });
    });
  }

  function discardChanges() {
    setDraftSquad(savedSquad);
    setSelectedChip(savedChip);
    setSaveMessage("");
  }

  function saveChanges() {
    const input: SaveSquadDraftInput = {
      chip: selectedChip,
      gameweekId: upcomingGameweek?.id ?? null,
      players: draftSquad.map((player) => ({
        is_captain: player.is_captain,
        player_id: player.id,
        position: player.position,
      })),
    };

    setSaveMessage("");
    startSaving(async () => {
      const result = await saveSquadDraft(input);

      if (result.error) {
        setSaveMessage(result.error);
        return;
      }

      setSavedSquad(draftSquad);
      setSavedChip(selectedChip);
      setSaveMessage("Team saved.");
    });
  }

  return (
    <section className="table-panel min-w-0 rounded-lg border p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">
            {teamName}
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">My squad</h1>
          <p className="mt-2 text-sm text-sky-100/60">
            Pick four main players, two bench players, and one captain. Maximum
            two players per club.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {isDirty ? (
            <button
              className="h-11 rounded-md border border-white/20 px-4 text-sm font-semibold text-sky-100 hover:border-white/50 hover:bg-white/5 disabled:opacity-40"
              disabled={isSaving}
              onClick={discardChanges}
              type="button"
            >
              Discard
            </button>
          ) : null}
          <button
            className="h-11 min-w-28 rounded-md bg-emerald-300 px-5 text-sm font-bold text-sky-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            disabled={!isDirty || isSaving || transfersLocked}
            onClick={saveChanges}
            type="button"
          >
            {isSaving ? "Saving…" : "Save team"}
          </button>
        </div>
      </div>

      <div aria-live="polite" className="mt-3 min-h-5 text-sm">
        {saveMessage && saveMessage !== "Team saved." ? (
          <span className="text-red-200">{saveMessage}</span>
        ) : isDirty ? (
          <span className="text-amber-200">You have unsaved changes.</span>
        ) : saveMessage ? (
          <span
            className={
              saveMessage === "Team saved."
                ? "text-emerald-200"
                : "text-red-200"
            }
          >
            {saveMessage}
          </span>
        ) : (
          <span className="text-sky-100/50">All changes are saved.</span>
        )}
      </div>

      <ChipSelector
        migrationMissing={chipMigrationMissing}
        onChange={(chip) => {
          setSaveMessage("");
          setSelectedChip(chip);
        }}
        selectedChip={selectedChip}
        selections={chipSelections}
        transfersLocked={transfersLocked}
        upcomingGameweek={upcomingGameweek}
      />

      <div className="mt-6 flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-white/10" />
        <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-sky-100/50 sm:text-sm">
          Player selection
        </h2>
        <span aria-hidden="true" className="h-px flex-1 bg-white/10" />
      </div>

      <dl className="mt-4 grid gap-1.5 text-sm text-sky-100/60 sm:flex sm:flex-wrap sm:gap-x-7 sm:text-base">
        <div className="flex items-baseline gap-1">
          <dt>Budget left:</dt>
          <dd className="font-bold text-sky-100">
            {formatMoney(remainingBudget)}
          </dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt>Number transfers left:</dt>
          <dd className="font-bold text-sky-100">
            {transferSummaryMigrationMissing
              ? "Migration needed"
              : transferSummary.remainingLabel}
          </dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt>Transfer cost:</dt>
          <dd className="font-bold text-sky-100">
            {transferSummary.penaltyPoints < 0
              ? `${transferSummary.penaltyPoints} pts`
              : "0 pts"}
          </dd>
        </div>
      </dl>

      <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-3 lg:gap-3">
        <div className="min-w-0 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h3 className="text-sm font-bold text-sky-100">Main players</h3>
            <span className="text-xs font-semibold text-sky-100/55">
              {starters.length} / {STARTER_SIZE}
            </span>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
            {starters.map((player) => (
              <SquadCard
                key={player.id}
                onMakeCaptain={() => makeCaptain(player.id)}
                onRemove={() => removePlayer(player.id)}
                onReplace={(incomingPlayer) =>
                  replacePlayer(player.id, incomingPlayer)
                }
                onSwapPosition={(targetPlayerId) =>
                  swapPositions(player.id, targetPlayerId)
                }
                player={player}
                remainingBudget={remainingBudget}
                selectedClubIds={selectedClubIds}
                selectedPlayerIds={selectedPlayerIds}
                swapTargets={bench}
                transfersLocked={transfersLocked}
              />
            ))}
            {starters.length < STARTER_SIZE ? (
              <PlayerPicker
                onSelect={(player) => addPlayer(player, "starter")}
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
            <h3 className="text-sm font-bold text-sky-100">Bench</h3>
            <span className="text-xs font-semibold text-sky-100/55">
              {bench.length} / {BENCH_SIZE}
            </span>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
            {bench.map((player) => (
              <SquadCard
                key={player.id}
                onMakeCaptain={() => makeCaptain(player.id)}
                onRemove={() => removePlayer(player.id)}
                onReplace={(incomingPlayer) =>
                  replacePlayer(player.id, incomingPlayer)
                }
                onSwapPosition={(targetPlayerId) =>
                  swapPositions(player.id, targetPlayerId)
                }
                player={player}
                remainingBudget={remainingBudget}
                selectedClubIds={selectedClubIds}
                selectedPlayerIds={selectedPlayerIds}
                swapTargets={starters}
                transfersLocked={transfersLocked}
              />
            ))}
            {bench.length < BENCH_SIZE ? (
              <PlayerPicker
                onSelect={(player) => addPlayer(player, "bench")}
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
  );
}

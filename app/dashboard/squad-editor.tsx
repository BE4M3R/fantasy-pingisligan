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
const COURT_POSITION_STYLE = {
  padding:
    "clamp(0.5rem, 2.5vw, 1.5rem) clamp(0.75rem, 3.5vw, 1.5rem)",
};
const BENCH_POSITION_STYLE = {
  padding: "0 clamp(0.75rem, 3.5vw, 1.5rem)",
};

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
  transferWindowMessage: string;
  transferSummaryMigrationMissing: boolean;
  transfersLocked: boolean;
  upcomingGameweek: UpcomingGameweek | null;
};

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
}

function formatCompactPlayerName(player: DashboardPlayer) {
  const firstInitial = player.first_name.trim().slice(0, 1);

  return firstInitial
    ? `${firstInitial}.${player.last_name}`
    : player.last_name;
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
          className="h-auto w-auto max-h-9 max-w-9 object-contain"
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
      <div className="flex min-w-0 w-full flex-col items-center">
        <ClubLogoBadge clubName={clubName} />
        <h3 className="mt-2 min-w-0 w-full text-xs font-bold leading-tight sm:text-sm">
          <span className="line-clamp-2">
            {formatCompactPlayerName(player)}
          </span>
        </h3>
        <p className="mt-1 min-w-0 w-full truncate text-[0.65rem] text-sky-100/65 sm:text-xs">
          {clubName} · {formatMoney(player.price)}
        </p>
        {player.is_captain ? (
          <span
            aria-label="Captain"
            className="mt-2 inline-flex items-center justify-center rounded-full bg-emerald-300 font-black uppercase tracking-wide text-sky-950"
            style={{
              fontSize: "0.6rem",
              lineHeight: 1,
              padding: "0.2rem 0.5rem",
              whiteSpace: "nowrap",
            }}
          >
            Captain
          </span>
        ) : null}
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
  transferWindowMessage,
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

  function changeChip(chip: Chip | null) {
    setSaveMessage("");
    setSelectedChip(chip);
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
    <section aria-label="Squad editor" className="min-w-0">
      <div className="mb-3 sm:hidden">
        <ChipSelector
          compact
          migrationMissing={chipMigrationMissing}
          onChange={changeChip}
          selectedChip={selectedChip}
          selections={chipSelections}
          transfersLocked={transfersLocked}
          upcomingGameweek={upcomingGameweek}
        />
      </div>

      <div className="table-panel rounded-lg border p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <p
            className={`flex min-w-0 items-start gap-2 pt-1 text-xs font-semibold leading-5 sm:text-sm ${
              transfersLocked ? "text-red-200" : "text-emerald-200"
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                transfersLocked ? "bg-red-300" : "bg-emerald-300"
              }`}
            />
            <span>{transferWindowMessage}</span>
          </p>

          <button
            className="h-9 min-w-20 shrink-0 rounded-md bg-emerald-300 px-3 text-xs font-bold text-sky-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            disabled={!isDirty || isSaving || transfersLocked}
            onClick={saveChanges}
            type="button"
          >
            {isSaving ? "Saving…" : "Save team"}
          </button>
        </div>

        <div className="hidden sm:block">
          <ChipSelector
            migrationMissing={chipMigrationMissing}
            onChange={changeChip}
            selectedChip={selectedChip}
            selections={chipSelections}
            transfersLocked={transfersLocked}
            upcomingGameweek={upcomingGameweek}
          />
        </div>

        <dl className="mt-4 grid gap-1.5 border-t border-white/10 pt-4 text-xs">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sky-100/50">Budget left</dt>
            <dd className="font-bold text-sky-100">
              {formatMoney(remainingBudget)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sky-100/50">Transfers left</dt>
            <dd className="font-bold text-sky-100">
              {transferSummaryMigrationMissing
                ? "Migration needed"
                : transferSummary.remainingLabel}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sky-100/50">Transfer cost</dt>
            <dd className="font-bold text-sky-100">
              {transferSummary.penaltyPoints < 0
                ? `${transferSummary.penaltyPoints} pts`
                : "0 pts"}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex items-center justify-between gap-4 text-xs">
          <div aria-live="polite">
            {saveMessage && saveMessage !== "Team saved." ? (
              <span className="text-red-200">{saveMessage}</span>
            ) : isDirty ? (
              <span className="text-amber-200">
                You have unsaved changes.
              </span>
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
            ) : null}
          </div>
          {isDirty ? (
            <button
              className="shrink-0 font-semibold text-sky-100/65 underline decoration-white/25 underline-offset-4 transition hover:text-white disabled:opacity-40"
              disabled={isSaving}
              onClick={discardChanges}
              type="button"
            >
              Discard changes
            </button>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="starting-lineup-title" className="mt-5">
        <div className="mx-auto mb-4 flex max-w-2xl items-end justify-between gap-4 px-1">
          <h2
            className="text-xl font-black tracking-tight sm:text-2xl"
            id="starting-lineup-title"
          >
            Select your squad
          </h2>
          <span className="rounded-full border border-white/15 bg-sky-950/45 px-3 py-1 text-xs font-bold text-sky-100/70">
            {starters.length} / {STARTER_SIZE}
          </span>
        </div>

        <div className="px-1 py-2 sm:px-6">
          <div className="mx-auto w-full max-w-2xl">
            <div
              className="relative w-full"
              style={{ paddingBottom: "125%" }}
            >
              <div
                aria-label="Table tennis starting lineup"
                className="absolute inset-0 grid grid-cols-2 grid-rows-2 overflow-visible rounded-md"
                role="group"
                style={{
                  backgroundColor: "#087ea4",
                  backgroundImage:
                    "radial-gradient(circle at 18% 12%, rgba(125, 211, 252, 0.2), transparent 38%), linear-gradient(145deg, rgba(255, 255, 255, 0.06), transparent 52%), linear-gradient(135deg, #0786a8 0%, #08789c 54%, #086d8f 100%)",
                  border: "3px solid rgba(255, 255, 255, 0.95)",
                  boxShadow:
                    "0 5px 0 #064c68, 0 22px 42px rgba(2, 6, 23, 0.34), inset 0 0 34px rgba(3, 31, 50, 0.16)",
                  isolation: "isolate",
                }}
              >
                {Array.from({ length: STARTER_SIZE }, (_, index) => {
                  const player = starters[index];

                  return (
                    <div
                      className="relative z-10 flex min-w-0 items-center justify-center"
                      key={player?.id ?? `starter-slot-${index}`}
                      style={COURT_POSITION_STYLE}
                    >
                      {player ? (
                        <SquadCard
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
                      ) : index === starters.length ? (
                        <PlayerPicker
                          onSelect={(selectedPlayer) =>
                            addPlayer(selectedPlayer, "starter")
                          }
                          position="starter"
                          remainingBudget={remainingBudget}
                          selectedClubIds={selectedClubIds}
                          selectedPlayerIds={selectedPlayerIds}
                          transfersLocked={transfersLocked}
                          trigger="court"
                        />
                      ) : (
                        <div
                          aria-label="Empty main player slot"
                          className="court-empty-slot flex w-full max-w-52 items-center justify-center rounded-lg border border-dashed border-white/25 bg-slate-950/10 px-3 text-center text-xs font-semibold text-white/45 sm:text-sm"
                        >
                          Empty slot
                        </div>
                      )}
                    </div>
                  );
                })}

                <div
                  aria-hidden="true"
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.95)",
                    bottom: 0,
                    boxShadow: "0 0 1px rgba(255, 255, 255, 0.7)",
                    left: "50%",
                    pointerEvents: "none",
                    position: "absolute",
                    top: 0,
                    transform: "translateX(-50%)",
                    width: "3px",
                    zIndex: 5,
                  }}
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute z-20"
                  style={{
                    backgroundColor: "rgba(15, 23, 42, 0.3)",
                    backgroundImage:
                      "repeating-linear-gradient(to right, rgba(2, 23, 42, 0.78) 0, rgba(2, 23, 42, 0.78) 1px, transparent 1px, transparent 6px), repeating-linear-gradient(to bottom, rgba(2, 23, 42, 0.78) 0, rgba(2, 23, 42, 0.78) 1px, transparent 1px, transparent 5px)",
                    borderBottom: "2px solid rgba(2, 23, 42, 0.9)",
                    borderLeft: "4px solid #dbeafe",
                    borderRight: "4px solid #dbeafe",
                    borderTop: "3px solid rgba(255, 255, 255, 0.96)",
                    boxShadow: "0 4px 7px rgba(2, 6, 23, 0.35)",
                    height: "0.9rem",
                    left: "-0.65rem",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "calc(100% + 1.3rem)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="bench-title" className="mx-auto mt-3 max-w-2xl">
        <div className="mb-3 flex items-center justify-between gap-4 px-1">
          <h2 className="text-lg font-black" id="bench-title">
            Bench
          </h2>
          <span className="text-xs font-semibold text-sky-100/55">
            {bench.length} / {BENCH_SIZE}
          </span>
        </div>

        <div className="grid min-w-0 grid-cols-2 px-1">
          {Array.from({ length: BENCH_SIZE }, (_, index) => {
            const player = bench[index];

            if (player) {
              return (
                <div
                  className="flex min-w-0 justify-center"
                  key={player.id}
                  style={BENCH_POSITION_STYLE}
                >
                  <SquadCard
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
                </div>
              );
            }

            return index === bench.length ? (
              <div
                className="flex min-w-0 justify-center"
                key={`bench-picker-${index}`}
                style={BENCH_POSITION_STYLE}
              >
                <PlayerPicker
                  onSelect={(selectedPlayer) =>
                    addPlayer(selectedPlayer, "bench")
                  }
                  position="bench"
                  remainingBudget={remainingBudget}
                  selectedClubIds={selectedClubIds}
                  selectedPlayerIds={selectedPlayerIds}
                  transfersLocked={transfersLocked}
                  trigger="court"
                />
              </div>
            ) : (
              <div
                className="flex min-w-0 justify-center"
                key={`bench-empty-${index}`}
                style={BENCH_POSITION_STYLE}
              >
                <div
                  aria-label="Empty bench player slot"
                  className="flex min-h-28 w-full max-w-52 items-center justify-center rounded-lg border border-dashed border-white/15 bg-sky-950/20 px-2 text-center text-xs font-semibold text-sky-100/40"
                >
                  Empty slot
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </section>
  );
}

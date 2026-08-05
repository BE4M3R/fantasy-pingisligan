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
    "clamp(0.7rem, 2.2vw, 1.25rem) clamp(0.55rem, 2.5vw, 1.25rem)",
};
const BENCH_POSITION_STYLE = {
  padding: "0 clamp(0.4rem, 2.5vw, 1.25rem)",
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

function formatPlayerCardName(player: DashboardPlayer) {
  const firstInitial = player.first_name.trim().slice(0, 1);

  return firstInitial ? `${firstInitial}.${player.last_name}` : player.last_name;
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
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/15 bg-[#fffaf0] p-1">
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
        <h3 className="mt-2 line-clamp-2 min-w-0 w-full break-words text-xs font-black leading-[1.15] text-[var(--pf-text)] sm:text-sm">
          {formatPlayerCardName(player)}
        </h3>
        <p className="mt-1 hidden min-w-0 w-full leading-tight text-[var(--pf-text-muted)] sm:line-clamp-1 sm:text-[0.7rem]">
          {clubName}
        </p>
        <p className="mt-0.5 text-[0.65rem] font-bold text-[var(--pf-text)] sm:text-xs">
          {formatMoney(player.price)}
        </p>
        {player.is_captain || player.active === false ? (
          <div className="mt-1.5 flex flex-wrap justify-center gap-1">
            {player.is_captain ? (
              <span
                aria-label="Captain"
                className="inline-flex items-center justify-center rounded-full bg-[var(--pf-fantasy-yellow)] font-black uppercase tracking-wide text-[var(--pf-navy-deep)]"
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
            {player.active === false ? (
              <span className="inline-flex items-center justify-center rounded-full bg-[var(--pf-coral-soft)] px-2 py-0.5 text-[0.55rem] font-black uppercase leading-none text-[var(--pf-coral-text)] ring-1 ring-[var(--pf-coral)]/60">
                Unavailable
              </span>
            ) : null}
          </div>
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
  const isSquadComplete =
    starters.length === STARTER_SIZE && bench.length === BENCH_SIZE;
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
  const saveDisabled = !isDirty || isSaving || transfersLocked;
  const saveDisabledReason = transfersLocked
    ? "Transfer window closed"
    : !isDirty
      ? isSquadComplete
        ? "No changes"
        : "Complete your squad"
      : "";
  const saveButtonLabel = isSaving
    ? "Saving…"
    : saveDisabledReason === "No changes"
      ? "No changes"
      : "Save team";
  const saveHint =
    saveDisabledReason === "No changes" ? "" : saveDisabledReason;

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

  function swapPlayers(playerId: string, targetPlayerId: string) {
    setSaveMessage("");
    setDraftSquad((currentSquad) => {
      const playerIndex = currentSquad.findIndex(
        (player) => player.id === playerId,
      );
      const targetIndex = currentSquad.findIndex(
        (player) => player.id === targetPlayerId,
      );

      if (playerIndex < 0 || targetIndex < 0) return currentSquad;

      const player = currentSquad[playerIndex];
      const targetPlayer = currentSquad[targetIndex];
      if (player.position === targetPlayer.position) return currentSquad;

      const nextSquad = [...currentSquad];
      nextSquad[playerIndex] = {
        ...targetPlayer,
        position: player.position,
      };
      nextSquad[targetIndex] = {
        ...player,
        position: targetPlayer.position,
      };
      return nextSquad;
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
      <div className="table-panel rounded-lg border p-3.5 min-[390px]:p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 sm:gap-5">
          <div className="min-w-0">
            <p
              className={`text-[0.65rem] font-black uppercase tracking-[0.16em] ${
                transfersLocked
                  ? "text-[var(--pf-coral)]"
                  : "text-[var(--pf-brand-blue)]"
              }`}
            >
              Transfer deadline
            </p>
            <p className="mt-1 text-xs font-bold leading-5 text-[var(--pf-text)] sm:text-sm">
              {transferWindowMessage}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <button
              aria-describedby={saveHint ? "save-disabled-reason" : undefined}
              className="h-10 min-w-24 rounded-md bg-[var(--pf-brand-blue)] px-3 text-xs font-black text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)] disabled:cursor-not-allowed disabled:border disabled:border-[var(--pf-card-border)] disabled:bg-[var(--pf-navy-elevated)] disabled:text-[var(--pf-text-muted)]/55"
              disabled={saveDisabled}
              onClick={saveChanges}
              type="button"
            >
              {saveButtonLabel}
            </button>
            {saveHint ? (
              <p
                className="mt-1 max-w-24 text-center text-[0.62rem] font-semibold leading-3 text-[var(--pf-text-muted)]"
                id="save-disabled-reason"
              >
                {saveHint}
              </p>
            ) : null}
          </div>
        </div>

        <div className="sm:hidden">
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

        <dl className="mt-3 grid grid-cols-3 gap-1 border-t border-[var(--pf-card-border)] pt-2.5 text-center min-[390px]:gap-2">
          <div className="min-w-0 rounded-md bg-[var(--pf-navy-elevated)] px-0.5 py-1.5 min-[390px]:px-1">
            <dt className="whitespace-nowrap text-[0.6rem] font-semibold uppercase tracking-[-0.025em] text-[var(--pf-text-muted)] min-[390px]:tracking-normal sm:text-[0.65rem] sm:tracking-wide">
              Budget left
            </dt>
            <dd
              className={`mt-0.5 text-xs font-black sm:text-sm ${
                remainingBudget < 0
                  ? "text-[var(--pf-coral)]"
                  : "text-[var(--pf-text)]"
              }`}
            >
              {formatMoney(remainingBudget)}
            </dd>
          </div>
          <div className="min-w-0 rounded-md bg-[var(--pf-navy-elevated)] px-0.5 py-1.5 min-[390px]:px-1">
            <dt className="whitespace-nowrap text-[0.6rem] font-semibold uppercase tracking-[-0.025em] text-[var(--pf-text-muted)] min-[390px]:tracking-normal sm:text-[0.65rem] sm:tracking-wide">
              Transfers left
            </dt>
            <dd className="mt-0.5 break-words text-xs font-black text-[var(--pf-text)] sm:text-sm">
              {transferSummaryMigrationMissing
                ? "Migration needed"
                : transferSummary.remainingLabel}
            </dd>
          </div>
          <div className="min-w-0 rounded-md bg-[var(--pf-navy-elevated)] px-0.5 py-1.5 min-[390px]:px-1">
            <dt className="whitespace-nowrap text-[0.6rem] font-semibold uppercase tracking-[-0.025em] text-[var(--pf-text-muted)] min-[390px]:tracking-normal sm:text-[0.65rem] sm:tracking-wide">
              Transfer cost
            </dt>
            <dd
              className={`mt-0.5 text-xs font-black sm:text-sm ${
                transferSummary.penaltyPoints < 0
                  ? "text-[var(--pf-coral)]"
                  : "text-[var(--pf-text)]"
              }`}
            >
              {transferSummary.penaltyPoints < 0
                ? `${transferSummary.penaltyPoints} pts`
                : "0 pts"}
            </dd>
          </div>
        </dl>

        {saveMessage || isDirty ? (
          <div className="mt-2.5 flex items-center justify-between gap-4 text-xs">
          <div aria-live="polite">
            {saveMessage && saveMessage !== "Team saved." ? (
              <span className="text-[var(--pf-coral-text)]">{saveMessage}</span>
            ) : isDirty ? (
              <span className="text-[var(--pf-fantasy-yellow)]">
                You have unsaved changes.
              </span>
            ) : saveMessage ? (
              <span
                className={
                  saveMessage === "Team saved."
                    ? "text-[var(--pf-brand-blue-hover)]"
                    : "text-[var(--pf-coral-text)]"
                }
              >
                {saveMessage}
              </span>
            ) : null}
          </div>
          {isDirty ? (
            <button
              className="shrink-0 font-semibold text-[var(--pf-brand-blue)] underline decoration-[var(--pf-brand-blue)]/35 underline-offset-4 transition hover:text-[var(--pf-brand-blue-hover)] disabled:opacity-40"
              disabled={isSaving}
              onClick={discardChanges}
              type="button"
            >
              Discard changes
            </button>
          ) : null}
          </div>
        ) : null}
      </div>

      <section aria-labelledby="starting-lineup-title" className="mt-5">
        <div className="mx-auto mb-4 flex max-w-2xl items-end justify-between gap-4 px-1">
          <h2
            className="text-xl font-black tracking-tight sm:text-2xl"
            id="starting-lineup-title"
          >
            Select your squad
          </h2>
          <span className="rounded-full border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] px-3 py-1 text-xs font-bold text-[var(--pf-text-muted)]">
            {starters.length} / {STARTER_SIZE}
          </span>
        </div>

        <div className="py-1 sm:px-6">
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
                  background: "var(--pf-table-blue)",
                  border: "2px solid rgba(242, 246, 248, 0.68)",
                  boxShadow:
                    "0 4px 0 var(--pf-table-blue-deep), 0 18px 38px rgba(1, 23, 43, 0.3), inset 0 0 32px rgba(1, 33, 60, 0.16)",
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
                            swapPlayers(player.id, targetPlayerId)
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
                          className="court-empty-slot flex w-full max-w-52 items-center justify-center rounded-lg border border-dashed border-white/30 bg-[var(--pf-navy)]/20 px-3 text-center text-xs font-semibold text-white/55 sm:text-sm"
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
                    backgroundColor: "rgba(242, 246, 248, 0.58)",
                    bottom: 0,
                    boxShadow: "0 0 1px rgba(255, 255, 255, 0.7)",
                    left: "50%",
                    pointerEvents: "none",
                    position: "absolute",
                    top: 0,
                    transform: "translateX(-50%)",
                    width: "2px",
                    zIndex: 5,
                  }}
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute z-20"
                  style={{
                    backgroundColor: "rgba(1, 23, 43, 0.8)",
                    backgroundImage:
                      "repeating-linear-gradient(to right, rgba(207, 230, 247, 0.42) 0, rgba(207, 230, 247, 0.42) 1px, transparent 1px, transparent 8px), repeating-linear-gradient(to bottom, rgba(207, 230, 247, 0.3) 0, rgba(207, 230, 247, 0.3) 1px, transparent 1px, transparent 5px)",
                    borderBottom: "1px solid rgba(1, 23, 43, 0.9)",
                    borderLeft: "2px solid rgba(242, 246, 248, 0.75)",
                    borderRight: "2px solid rgba(242, 246, 248, 0.75)",
                    borderTop: "2px solid rgba(242, 246, 248, 0.78)",
                    boxShadow: "0 3px 5px rgba(1, 23, 43, 0.28)",
                    height: "0.9rem",
                    left: "-0.35rem",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "calc(100% + 0.7rem)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="bench-title" className="mx-auto mt-2 max-w-2xl">
        <div className="mb-2 flex items-center justify-between gap-4 px-1">
          <h2 className="text-lg font-black" id="bench-title">
            Bench
          </h2>
          <span className="text-xs font-semibold text-[var(--pf-text-muted)]">
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
                      swapPlayers(player.id, targetPlayerId)
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
                  className="flex min-h-28 w-full max-w-52 items-center justify-center rounded-lg border border-dashed border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)]/45 px-2 text-center text-xs font-semibold text-[var(--pf-text-muted)]/60"
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

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  ResultGameweek,
  SquadPlayerResult,
  SquadPosition,
} from "@/app/dashboard/player-types";
import { getDisplayedResultPoints } from "@/app/dashboard/player-types";
import { SquadCardActions } from "@/app/dashboard/squad-card-actions";

const STARTER_SIZE = 4;
const BENCH_SIZE = 2;
const MAX_FREE_TRANSFERS = 4;
const COURT_POSITION_STYLE = {
  padding:
    "clamp(0.25rem, 1vw, 0.55rem) clamp(0.45rem, 1.5vw, 0.75rem)",
};
const BENCH_POSITION_STYLE = {
  padding: "0 clamp(0.45rem, 1.5vw, 0.75rem)",
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
  initialViewMode: "transfers" | "results";
  initialSquad: DraftSquadPlayer[];
  latestResultSquad: SquadPlayerResult[];
  latestResultTransferPenalty: number;
  lockedGameweekId: string | null;
  previousPlayerIds: string[];
  resultGameweeks: ResultGameweek[];
  resultModeMigrationMissing: boolean;
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
  result,
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
  result?: SquadPlayerResult;
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
      result={result}
    >
      <div className="flex min-w-0 w-full flex-col items-center">
        <ClubLogoBadge clubName={clubName} />
        <h3 className="mt-1.5 line-clamp-2 min-w-0 w-full break-words text-xs font-black leading-[1.15] text-[var(--pf-text)] sm:text-sm">
          {formatPlayerCardName(player)}
        </h3>
        <p className="mt-1 hidden min-w-0 w-full leading-tight text-[var(--pf-text-muted)] sm:line-clamp-1 sm:text-[0.7rem]">
          {clubName}
        </p>
        <p className="mt-0.5 text-[0.65rem] font-bold text-[var(--pf-text)] sm:text-xs">
          {result
            ? `${getDisplayedResultPoints(result)} pts`
            : formatMoney(player.price)}
        </p>
        {player.is_captain || player.active === false || result?.automatic_substitution ? (
          <div className="absolute left-1.5 top-1.5 z-10 flex flex-col items-start gap-1 sm:static sm:mt-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
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
                <span className="sm:hidden">C</span>
                <span className="hidden sm:inline">Captain</span>
              </span>
            ) : null}
            {player.active === false ? (
              <span className="inline-flex items-center justify-center rounded-full bg-[var(--pf-coral-soft)] px-2 py-0.5 text-[0.55rem] font-black uppercase leading-none text-[var(--pf-coral-text)] ring-1 ring-[var(--pf-coral)]/60">
                Unavailable
              </span>
            ) : null}
            {result?.automatic_substitution ? (
              <span
                aria-label={
                  result.automatic_substitution === "in"
                    ? "Subbed in"
                    : "Subbed out"
                }
                className="inline-flex items-center justify-center rounded-full bg-[var(--pf-brand-blue-soft)] px-2 py-0.5 text-[0.55rem] font-black uppercase leading-none text-[var(--pf-brand-blue-hover)] ring-1 ring-[var(--pf-brand-blue-border)]"
              >
                <span className="sm:hidden">
                  {result.automatic_substitution === "in"
                    ? "Sub in"
                    : "Sub out"}
                </span>
                <span className="hidden sm:inline">
                  {result.automatic_substitution === "in"
                    ? "Subbed in"
                    : "Subbed out"}
                </span>
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
  initialViewMode,
  initialSquad,
  latestResultSquad,
  latestResultTransferPenalty,
  lockedGameweekId,
  previousPlayerIds,
  resultGameweeks,
  resultModeMigrationMissing,
  transferWindowMessage,
  transferSummaryMigrationMissing,
  transfersLocked,
  upcomingGameweek,
}: SquadEditorProps) {
  const router = useRouter();
  const leaveDialogRef = useRef<HTMLDialogElement>(null);
  const allowNavigationRef = useRef(false);
  const [draftSquad, setDraftSquad] =
    useState<DraftSquadPlayer[]>(initialSquad);
  const [selectedChip, setSelectedChip] = useState<Chip | null>(initialChip);
  const [savedSquad, setSavedSquad] =
    useState<DraftSquadPlayer[]>(initialSquad);
  const [savedChip, setSavedChip] = useState<Chip | null>(initialChip);
  const [viewMode, setViewMode] =
    useState<"transfers" | "results">(initialViewMode);
  const [saveMessage, setSaveMessage] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null,
  );
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
  const resultStarters = latestResultSquad.filter(
    (player) => player.position === "starter",
  );
  const resultBench = latestResultSquad.filter(
    (player) => player.position === "bench",
  );
  const displayedStarters =
    viewMode === "results" ? resultStarters : starters;
  const displayedBench = viewMode === "results" ? resultBench : bench;
  const latestResult = latestResultSquad[0] ?? null;
  const selectedResultGameweekIndex = resultGameweeks.findIndex(
    ({ id }) => id === latestResult?.gameweek_id,
  );
  const previousResultGameweek =
    selectedResultGameweekIndex > 0
      ? resultGameweeks[selectedResultGameweekIndex - 1]
      : null;
  const nextResultGameweek =
    selectedResultGameweekIndex >= 0 &&
    selectedResultGameweekIndex < resultGameweeks.length - 1
      ? resultGameweeks[selectedResultGameweekIndex + 1]
      : null;
  const latestResultLabel = latestResult
    ? latestResult.round_order !== null
      ? `Gameweek ${latestResult.round_order}`
      : latestResult.gameweek_name.replace(/^round\s*/i, "Gameweek ")
    : null;
  const latestResultTotalPoints =
    latestResultSquad.reduce(
      (total, player) => total + player.team_points_contribution,
      0,
    ) + latestResultTransferPenalty;
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
      if (allowNavigationRef.current) return;
      event.preventDefault();
    };

    const guardLinkNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      const link =
        target instanceof Element ? target.closest("a[href]") : null;

      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        link.href === window.location.href
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation(link.href);
    };

    window.addEventListener("beforeunload", warnAboutUnsavedChanges);
    document.addEventListener("click", guardLinkNavigation, true);

    return () => {
      window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
      document.removeEventListener("click", guardLinkNavigation, true);
    };
  }, [isDirty]);

  useEffect(() => {
    if (pendingNavigation && !leaveDialogRef.current?.open) {
      leaveDialogRef.current?.showModal();
    }
  }, [pendingNavigation]);

  function closeLeaveDialog() {
    leaveDialogRef.current?.close();
    setPendingNavigation(null);
  }

  function leaveWithoutSaving() {
    if (!pendingNavigation) return;

    const destination = new URL(pendingNavigation);
    allowNavigationRef.current = true;
    leaveDialogRef.current?.close();
    setPendingNavigation(null);

    if (destination.origin === window.location.origin) {
      router.push(
        `${destination.pathname}${destination.search}${destination.hash}`,
      );
      return;
    }

    window.location.assign(destination.href);
  }

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
      <div className="table-panel mx-auto max-w-2xl rounded-lg border p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className={`text-[0.65rem] font-black uppercase tracking-[0.16em] ${
                transfersLocked
                  ? "text-[var(--pf-coral)]"
                  : "text-[var(--pf-brand-blue)]"
              }`}
            >
              {transfersLocked ? "Transfers closed" : "Transfer deadline"}
            </p>
            <p className="mt-1 text-xs font-bold leading-5 text-[var(--pf-text)] sm:text-sm">
              {transferWindowMessage}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <button
              aria-label={
                saveHint ? `${saveButtonLabel}: ${saveHint}` : saveButtonLabel
              }
              className="h-9 min-w-24 rounded-md bg-[var(--pf-brand-blue)] px-3 text-xs font-black text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)] disabled:cursor-not-allowed disabled:border disabled:border-[var(--pf-card-border)] disabled:bg-[var(--pf-navy-elevated)] disabled:text-[var(--pf-text-muted)]/55"
              disabled={saveDisabled}
              onClick={saveChanges}
              type="button"
            >
              {saveButtonLabel}
            </button>
          </div>
        </div>

        <ChipSelector
          compact
          lockedGameweekId={lockedGameweekId}
          migrationMissing={chipMigrationMissing}
          onChange={changeChip}
          selectedChip={selectedChip}
          selections={chipSelections}
          transfersLocked={transfersLocked}
          upcomingGameweek={upcomingGameweek}
        />

        <dl className="mt-2 grid grid-cols-3 gap-1 border-t border-[var(--pf-card-border)] pt-2 text-center min-[390px]:gap-2">
          <div className="min-w-0 rounded-md bg-[var(--pf-navy-elevated)] px-0.5 py-1 min-[390px]:px-1">
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
          <div className="min-w-0 rounded-md bg-[var(--pf-navy-elevated)] px-0.5 py-1 min-[390px]:px-1">
            <dt className="whitespace-nowrap text-[0.6rem] font-semibold uppercase tracking-[-0.025em] text-[var(--pf-text-muted)] min-[390px]:tracking-normal sm:text-[0.65rem] sm:tracking-wide">
              Transfers left
            </dt>
            <dd className="mt-0.5 break-words text-xs font-black text-[var(--pf-text)] sm:text-sm">
              {transferSummaryMigrationMissing
                ? "Migration needed"
                : transferSummary.remainingLabel}
            </dd>
          </div>
          <div className="min-w-0 rounded-md bg-[var(--pf-navy-elevated)] px-0.5 py-1 min-[390px]:px-1">
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

      <div className="mx-auto mt-3 flex max-w-2xl justify-center px-1">
        <div
          aria-label="Squad view"
          className="grid w-full max-w-sm grid-cols-2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] p-1"
          role="group"
        >
          {(["transfers", "results"] as const).map((mode) => {
            const selected = viewMode === mode;

            return (
              <button
                aria-pressed={selected}
                className={`min-h-10 rounded-md px-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] ${
                  selected
                    ? "bg-[var(--pf-brand-blue)] text-[var(--pf-navy-deep)]"
                    : "text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-text)]"
                }`}
                key={mode}
                onClick={() => setViewMode(mode)}
                type="button"
              >
                {mode === "transfers" ? "Transfer mode" : "Result mode"}
              </button>
            );
          })}
        </div>
      </div>

      {viewMode === "results" && latestResult ? (
        <nav
          aria-label="Result gameweeks"
          className="mx-auto mt-3 grid max-w-sm grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] p-2"
        >
          {previousResultGameweek ? (
            <Link
              aria-label={`View previous gameweek: ${previousResultGameweek.name}`}
              className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
              href={`/dashboard?view=results&gameweek=${previousResultGameweek.id}`}
            >
              <span aria-hidden="true" className="text-2xl leading-none">
                ‹
              </span>
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] text-2xl leading-none text-[var(--pf-text-muted)]/35"
            >
              ‹
            </span>
          )}

          <div className="min-w-0 text-center">
            <p className="truncate text-[0.65rem] font-black uppercase tracking-[0.14em] text-[var(--pf-text-muted)]">
              {latestResultLabel}
            </p>
            <p className="mt-0.5 text-xl font-black text-[var(--pf-fantasy-yellow)]">
              {latestResultTotalPoints} pts
            </p>
            <p className="mt-0.5 min-h-4 text-[0.65rem] leading-4 text-[var(--pf-text-muted)]">
              {latestResultTransferPenalty !== 0
                ? `Includes ${latestResultTransferPenalty} pts transfer cost`
                : "No transfer cost"}
            </p>
          </div>

          {nextResultGameweek ? (
            <Link
              aria-label={`View next gameweek: ${nextResultGameweek.name}`}
              className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
              href={`/dashboard?view=results&gameweek=${nextResultGameweek.id}`}
            >
              <span aria-hidden="true" className="text-2xl leading-none">
                ›
              </span>
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] text-2xl leading-none text-[var(--pf-text-muted)]/35"
            >
              ›
            </span>
          )}
        </nav>
      ) : null}

      {viewMode === "results" && !latestResult ? (
        <div className="mx-auto mt-4 max-w-2xl rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-4 text-center text-sm text-[var(--pf-text-muted)]">
          {resultModeMigrationMissing
            ? "Result mode needs the latest database migration."
            : "No results available yet"}
        </div>
      ) : null}

      <section
        aria-labelledby="starting-lineup-title"
        className={`mt-3 ${viewMode === "results" && !latestResult ? "hidden" : ""}`}
      >
        <div className="mx-auto mb-2 flex max-w-xl items-end justify-between gap-4 px-1">
          <h2
            className="text-xl font-black tracking-tight sm:text-2xl"
            id="starting-lineup-title"
          >
            {viewMode === "results"
              ? `Results for ${latestResultLabel}`
              : transfersLocked
                ? "Squad locked"
                : "Select your squad"}
          </h2>
          <span className="rounded-full border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] px-3 py-1 text-xs font-bold text-[var(--pf-text-muted)]">
            {displayedStarters.length} / {STARTER_SIZE}
          </span>
        </div>

        <div>
          <div className="mx-auto w-full max-w-xl">
            <div
              className="relative w-full"
              style={{ paddingBottom: "66%" }}
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
                  const player = displayedStarters[index];

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
                          result={
                            viewMode === "results"
                              ? latestResultSquad.find(
                                  (row) => row.id === player.id,
                                )
                              : undefined
                          }
                        />
                      ) : viewMode === "transfers" &&
                        index === starters.length ? (
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
                    boxShadow: "0 0 1px rgba(255, 255, 255, 0.7)",
                    height: "2px",
                    left: 0,
                    pointerEvents: "none",
                    position: "absolute",
                    right: 0,
                    top: "50%",
                    transform: "translateY(-50%)",
                    zIndex: 5,
                  }}
                />
                <div
                  aria-hidden="true"
                  className="squad-table-net pointer-events-none absolute z-20"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="bench-title"
        className={`mx-auto mt-2 max-w-2xl ${viewMode === "results" && !latestResult ? "hidden" : ""}`}
      >
        <div className="mb-2 flex items-center justify-between gap-4 px-1">
          <h2 className="text-lg font-black" id="bench-title">
            Bench
          </h2>
          <span className="text-xs font-semibold text-[var(--pf-text-muted)]">
            {displayedBench.length} / {BENCH_SIZE}
          </span>
        </div>

        <div className="grid min-w-0 grid-cols-2 px-1">
          {Array.from({ length: BENCH_SIZE }, (_, index) => {
            const player = displayedBench[index];

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
                    result={
                      viewMode === "results"
                        ? latestResultSquad.find((row) => row.id === player.id)
                        : undefined
                    }
                  />
                </div>
              );
            }

            return viewMode === "transfers" && index === bench.length ? (
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

      <dialog
        aria-labelledby="unsaved-changes-title"
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-0 text-[var(--pf-text)] shadow-2xl backdrop:bg-[var(--pf-navy-deep)]/80"
        onClick={(event) => {
          if (event.target === leaveDialogRef.current) closeLeaveDialog();
        }}
        onClose={() => setPendingNavigation(null)}
        ref={leaveDialogRef}
      >
        <div className="p-5 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--pf-fantasy-yellow)]">
            Unsaved changes
          </p>
          <h2
            className="mt-2 text-xl font-black tracking-tight"
            id="unsaved-changes-title"
          >
            Leave without saving?
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--pf-text-muted)]">
            Your squad changes will be lost if you leave this page.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              className="h-11 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-3 text-sm font-semibold transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
              onClick={closeLeaveDialog}
              type="button"
            >
              Stay
            </button>
            <button
              className="h-11 rounded-md bg-[var(--pf-coral)] px-3 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-coral-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-coral)]"
              onClick={leaveWithoutSaving}
              type="button"
            >
              Leave without saving
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}

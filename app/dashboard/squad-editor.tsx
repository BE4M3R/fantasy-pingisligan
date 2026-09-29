"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  confirmGameweekChip,
  saveSquadDraft,
  type SaveSquadDraftInput,
} from "@/app/dashboard/actions";
import {
  ChipSelector,
  type Chip,
  type ChipSelection,
} from "@/app/dashboard/chip-selector";
import { PlayerPicker } from "@/app/dashboard/player-picker";
import type {
  DashboardPlayer,
  DraftSquadPlayer,
  ResultGameweek,
  SquadPlayerResult,
  SquadPosition,
} from "@/app/dashboard/player-types";
import { getDisplayedResultPoints } from "@/app/dashboard/player-types";
import { SquadCardVisual } from "@/app/dashboard/squad-card-visual";
import { SquadCardActions } from "@/app/dashboard/squad-card-actions";
import { BENCH_SIZE, STARTER_SIZE, SquadLineupView } from "@/app/dashboard/squad-lineup-view";
import {
  canReplaceClub,
  canTransferFromClub,
  CLUB_LIMIT_MESSAGE,
  getOverLimitClubIds,
} from "@/lib/squad-club-limit";

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

type ResultGameweekPayload = {
  squad: SquadPlayerResult[];
  transferPenalty: number;
};

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
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

function orderResultSquadLikeDraft(
  results: SquadPlayerResult[],
  draft: DraftSquadPlayer[],
) {
  const resultByPlayerId = new Map(
    results.map((result) => [result.id, result]),
  );
  const subbedIn = results.filter(
    (result) => result.automatic_substitution === "in",
  );
  const subbedOut = results.filter(
    (result) => result.automatic_substitution === "out",
  );
  const subbedInByOutgoingPlayerId = new Map(
    subbedOut.map((outgoingPlayer, index) => [
      outgoingPlayer.id,
      subbedIn[index],
    ]),
  );
  const subbedOutByIncomingPlayerId = new Map(
    subbedIn.map((incomingPlayer, index) => [
      incomingPlayer.id,
      subbedOut[index],
    ]),
  );
  const usedPlayerIds = new Set<string>();

  function orderPosition(position: SquadPosition) {
    const ordered = draft.flatMap((draftPlayer) => {
      if (draftPlayer.position !== position) return [];

      const directResult = resultByPlayerId.get(draftPlayer.id);
      const result =
        position === "starter" &&
        directResult?.automatic_substitution === "out"
          ? subbedInByOutgoingPlayerId.get(draftPlayer.id)
          : position === "bench" &&
              directResult?.automatic_substitution === "in"
            ? subbedOutByIncomingPlayerId.get(draftPlayer.id)
            : directResult;

      if (!result || result.position !== position) return [];

      usedPlayerIds.add(result.id);
      return [result];
    });

    return [
      ...ordered,
      ...results.filter(
        (result) =>
          result.position === position && !usedPlayerIds.has(result.id),
      ),
    ];
  }

  return [...orderPosition("starter"), ...orderPosition("bench")];
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
      <SquadCardVisual
        player={player}
        resultPoints={result ? getDisplayedResultPoints(result) : undefined}
        automaticSubstitution={result?.automatic_substitution}
      />
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
  const [resultSquad, setResultSquad] =
    useState<SquadPlayerResult[]>(latestResultSquad);
  const [resultTransferPenalty, setResultTransferPenalty] = useState(
    latestResultTransferPenalty,
  );
  const [resultLoadError, setResultLoadError] = useState("");
  const [isResultLoading, setIsResultLoading] = useState(false);
  const resultCacheRef = useRef(
    new Map<string, ResultGameweekPayload>(
      latestResultSquad[0]
        ? [
            [
              latestResultSquad[0].gameweek_id,
              {
                squad: latestResultSquad,
                transferPenalty: latestResultTransferPenalty,
              },
            ],
          ]
        : [],
    ),
  );
  const resultRequestsRef = useRef(new Map<string, Promise<ResultGameweekPayload>>());
  const resultRequestRef = useRef(0);
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
  const orderedResultSquad = orderResultSquadLikeDraft(
    resultSquad,
    draftSquad,
  );
  const resultStarters = orderedResultSquad.filter(
    (player) => player.position === "starter",
  );
  const resultBench = orderedResultSquad.filter(
    (player) => player.position === "bench",
  );
  const displayedStarters =
    viewMode === "results" ? resultStarters : starters;
  const displayedBench = viewMode === "results" ? resultBench : bench;
  const latestResult = resultSquad[0] ?? null;
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
  const loadResultGameweek = useCallback((gameweekId: string) => {
    const cached = resultCacheRef.current.get(gameweekId);
    if (cached) return Promise.resolve(cached);

    const pending = resultRequestsRef.current;
    const existing = pending.get(gameweekId);
    if (existing) return existing;

    const request = (async () => {
      const response = await fetch(`/api/squad-results?gameweek=${gameweekId}`);
      const responseBody = (await response.json()) as
        | ResultGameweekPayload
        | { error?: string };

      if (!response.ok || !("squad" in responseBody)) {
        throw new Error(
          "error" in responseBody && responseBody.error
            ? responseBody.error
            : "This gameweek result could not be loaded.",
        );
      }

      resultCacheRef.current.set(gameweekId, responseBody);
      return responseBody;
    })().finally(() => pending.delete(gameweekId));
    pending.set(gameweekId, request);
    return request;
  }, []);

  useEffect(() => {
    if (viewMode !== "results" || selectedResultGameweekIndex < 0) return;

    for (const index of [selectedResultGameweekIndex - 1, selectedResultGameweekIndex + 1]) {
      const adjacent = resultGameweeks[index];
      if (adjacent) void loadResultGameweek(adjacent.id).catch(() => {
        // Navigation retries a failed background request.
      });
    }
  }, [viewMode, selectedResultGameweekIndex, resultGameweeks, loadResultGameweek]);
  const latestResultLabel = latestResult
    ? latestResult.round_order !== null
      ? `Gameweek ${latestResult.round_order}`
      : latestResult.gameweek_name.replace(/^round\s*/i, "Gameweek ")
    : null;
  const latestResultTotalPoints =
    resultSquad.reduce(
      (total, player) => total + player.team_points_contribution,
      0,
    ) + resultTransferPenalty;
  const selectedPlayerIds = draftSquad.map((player) => player.id);
  const selectedClubIds = draftSquad
    .map(getClubId)
    .filter((clubId): clubId is string => Boolean(clubId));
  const clubRepairRequired = getOverLimitClubIds(selectedClubIds).size > 0;
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
  const saveDisabled =
    !isDirty || isSaving || transfersLocked || !isSquadComplete || clubRepairRequired;
  const saveDisabledReason = transfersLocked
    ? "Transfer window closed"
    : clubRepairRequired
      ? CLUB_LIMIT_MESSAGE
      : !isSquadComplete
      ? "Complete your squad"
      : !isDirty
        ? "No changes"
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

  async function selectResultGameweek(gameweek: ResultGameweek) {
    if (gameweek.id === latestResult?.gameweek_id) return;

    const requestId = resultRequestRef.current + 1;
    resultRequestRef.current = requestId;
    setResultLoadError("");

    try {
      if (!resultCacheRef.current.has(gameweek.id)) setIsResultLoading(true);
      const payload = await loadResultGameweek(gameweek.id);

      if (resultRequestRef.current !== requestId) return;

      setResultSquad(payload.squad);
      setResultTransferPenalty(payload.transferPenalty);

      const url = new URL(window.location.href);
      url.searchParams.set("view", "results");
      url.searchParams.set("gameweek", gameweek.id);
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    } catch (error) {
      if (resultRequestRef.current === requestId) {
        setResultLoadError(
          error instanceof Error
            ? error.message
            : "This gameweek result could not be loaded.",
        );
      }
    } finally {
      if (resultRequestRef.current === requestId) {
        setIsResultLoading(false);
      }
    }
  }

  function changeViewMode(mode: "transfers" | "results") {
    setViewMode(mode);
    setResultLoadError("");

    if (mode !== "results" || viewMode === "results") return;

    const latestGameweek = resultGameweeks.at(-1);

    if (latestGameweek) {
      void selectResultGameweek(latestGameweek);
    }
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
    if (transfersLocked || clubRepairRequired) return;
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
    if (transfersLocked) return;
    setSaveMessage("");
    setDraftSquad((currentSquad) => {
      const outgoing = currentSquad.find((player) => player.id === outgoingPlayerId);
      if (!outgoing || !canReplaceClub(
        currentSquad.map(getClubId), getClubId(outgoing), getClubId(incomingPlayer),
      )) return currentSquad;
      return currentSquad.map((player) =>
        player.id === outgoingPlayerId
          ? {
              ...incomingPlayer,
              is_captain: player.is_captain,
              position: player.position,
            }
          : player,
      );
    });
  }

  function removePlayer(playerId: string) {
    if (transfersLocked) return;
    setSaveMessage("");
    setDraftSquad((currentSquad) => {
      const removedPlayer = currentSquad.find(
        (player) => player.id === playerId,
      );
      if (!removedPlayer || !canTransferFromClub(currentSquad.map(getClubId), getClubId(removedPlayer))) {
        return currentSquad;
      }
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
    if (transfersLocked || clubRepairRequired) return;
    setSaveMessage("");
    setDraftSquad((currentSquad) =>
      currentSquad.map((player) => ({
        ...player,
        is_captain: player.id === playerId,
      })),
    );
  }

  function swapPlayers(playerId: string, targetPlayerId: string) {
    if (transfersLocked || clubRepairRequired) return;
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

  async function changeChip(chip: Chip) {
    if (!upcomingGameweek) return false;

    setSaveMessage("");
    const result = await confirmGameweekChip({
      chip,
      gameweekId: upcomingGameweek.id,
    });

    if (result.error) {
      setSaveMessage(result.error);
      return false;
    }

    setSelectedChip(chip);
    setSavedChip(chip);
    return true;
  }

  function saveChanges() {
    if (saveDisabled) return;
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
                onClick={() => changeViewMode(mode)}
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
          aria-busy={isResultLoading}
          className="mx-auto mt-3 grid max-w-sm grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] p-2"
        >
          <button
            aria-label={
              previousResultGameweek
                ? `View previous gameweek: ${previousResultGameweek.name}`
                : "No previous gameweek"
            }
            className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] disabled:cursor-not-allowed disabled:border-[var(--pf-card-border)] disabled:text-[var(--pf-text-muted)]/35 disabled:hover:bg-[var(--pf-navy-elevated)]"
            disabled={!previousResultGameweek || isResultLoading}
            onClick={() => {
              if (previousResultGameweek) {
                void selectResultGameweek(previousResultGameweek);
              }
            }}
            type="button"
          >
            <span aria-hidden="true" className="text-2xl leading-none">
              ‹
            </span>
          </button>

          <div className="min-w-0 text-center">
            <p className="truncate text-[0.65rem] font-black uppercase tracking-[0.14em] text-[var(--pf-text-muted)]">
              {latestResultLabel}
            </p>
            <p className="mt-0.5 text-xl font-black text-[var(--pf-fantasy-yellow)]">
              {latestResultTotalPoints} pts
            </p>
            <p className="mt-0.5 min-h-4 text-[0.65rem] leading-4 text-[var(--pf-text-muted)]">
              {isResultLoading
                ? "Loading gameweek…"
                : resultTransferPenalty !== 0
                  ? `Includes ${resultTransferPenalty} pts transfer cost`
                  : "No transfer cost"}
            </p>
          </div>

          <button
            aria-label={
              nextResultGameweek
                ? `View next gameweek: ${nextResultGameweek.name}`
                : "No next gameweek"
            }
            className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] disabled:cursor-not-allowed disabled:border-[var(--pf-card-border)] disabled:text-[var(--pf-text-muted)]/35 disabled:hover:bg-[var(--pf-navy-elevated)]"
            disabled={!nextResultGameweek || isResultLoading}
            onClick={() => {
              if (nextResultGameweek) {
                void selectResultGameweek(nextResultGameweek);
              }
            }}
            type="button"
          >
            <span aria-hidden="true" className="text-2xl leading-none">
              ›
            </span>
          </button>
        </nav>
      ) : null}

      {viewMode === "results" && resultLoadError ? (
        <p
          aria-live="polite"
          className="mx-auto mt-2 max-w-sm rounded-md border border-[var(--pf-coral)]/40 bg-[var(--pf-coral-soft)] px-3 py-2 text-center text-xs text-[var(--pf-coral-text)]"
        >
          {resultLoadError}
        </p>
      ) : null}

      {viewMode === "results" && !latestResult ? (
        <div className="mx-auto mt-4 max-w-2xl rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-4 text-center text-sm text-[var(--pf-text-muted)]">
          {resultModeMigrationMissing
            ? "Result mode needs the latest database migration."
            : "No results available yet"}
        </div>
      ) : null}

      {viewMode === "transfers" && clubRepairRequired ? (
        <p
          className="mx-auto mb-3 max-w-xl rounded-md border border-[var(--pf-coral)]/45 bg-[var(--pf-coral-soft)] px-3 py-2 text-sm text-[var(--pf-coral-text)]"
          role="status"
        >
          <span className="font-semibold">{CLUB_LIMIT_MESSAGE}</span>
          <span className="mt-1 block text-xs">
            This includes main and bench players.
          </span>
        </p>
      ) : null}
      <SquadLineupView
        title={
          viewMode === "results"
            ? "Active players"
            : transfersLocked
              ? "Squad locked"
              : "Select your squad"
        }
        compactTitle={viewMode === "results"}
        starterCount={displayedStarters.length}
        benchCount={displayedBench.length}
        hidden={viewMode === "results" && !latestResult}
        dimmed={viewMode === "results" && isResultLoading}
        renderStarter={(index) => {
          const player = displayedStarters[index];
          return player ? (
            <SquadCard
              key={player.id}
              onMakeCaptain={() => makeCaptain(player.id)}
              onRemove={() => removePlayer(player.id)}
              onReplace={(incomingPlayer) => replacePlayer(player.id, incomingPlayer)}
              onSwapPosition={(targetPlayerId) => swapPlayers(player.id, targetPlayerId)}
              player={player}
              remainingBudget={remainingBudget}
              selectedClubIds={selectedClubIds}
              selectedPlayerIds={selectedPlayerIds}
              swapTargets={bench}
              transfersLocked={transfersLocked}
              result={viewMode === "results" ? resultSquad.find((row) => row.id === player.id) : undefined}
            />
          ) : viewMode === "transfers" && index === starters.length ? (
            <PlayerPicker
              onSelect={(selectedPlayer) => addPlayer(selectedPlayer, "starter")}
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
          );
        }}
        renderBench={(index) => {
          const player = displayedBench[index];
          return player ? (
            <SquadCard
              key={player.id}
              onMakeCaptain={() => makeCaptain(player.id)}
              onRemove={() => removePlayer(player.id)}
              onReplace={(incomingPlayer) => replacePlayer(player.id, incomingPlayer)}
              onSwapPosition={(targetPlayerId) => swapPlayers(player.id, targetPlayerId)}
              player={player}
              remainingBudget={remainingBudget}
              selectedClubIds={selectedClubIds}
              selectedPlayerIds={selectedPlayerIds}
              swapTargets={starters}
              transfersLocked={transfersLocked}
              result={viewMode === "results" ? resultSquad.find((row) => row.id === player.id) : undefined}
            />
          ) : viewMode === "transfers" && index === bench.length ? (
            <PlayerPicker
              onSelect={(selectedPlayer) => addPlayer(selectedPlayer, "bench")}
              position="bench"
              remainingBudget={remainingBudget}
              selectedClubIds={selectedClubIds}
              selectedPlayerIds={selectedPlayerIds}
              transfersLocked={transfersLocked}
              trigger="court"
            />
          ) : (
            <div
              aria-label="Empty bench player slot"
              className="flex min-h-28 w-full max-w-52 items-center justify-center rounded-lg border border-dashed border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)]/45 px-2 text-center text-xs font-semibold text-[var(--pf-text-muted)]/60"
            >
              Empty slot
            </div>
          );
        }}
      />

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

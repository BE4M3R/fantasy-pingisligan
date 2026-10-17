"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canonicalClubName } from "@/lib/clubs";
import { ClubLogo, ResultBreakdown } from "@/app/dashboard/result-player-details";
import { PlayerActionIcon } from "@/app/dashboard/player-action-icon";
import { PlayerPicker } from "@/app/dashboard/player-picker";
import { PlayerStatisticsPreview } from "@/app/dashboard/player-statistics-preview";
import { PlayerStatisticsButton } from "@/app/dashboard/player-statistics-button";
import { animatePopupOpen, type PopupOrigin } from "@/app/dashboard/popup-animation";
import { squadCardShellClass } from "@/app/dashboard/squad-card-visual";
import type {
  DashboardPlayer,
  DraftSquadPlayer,
  SquadPlayerResult,
} from "@/app/dashboard/player-types";
import { getDisplayedResultPoints } from "@/app/dashboard/player-types";
import { useBodyScrollLock } from "@/app/dashboard/use-body-scroll-lock";
import { canTransferFromClub, getOverLimitClubIds } from "@/lib/squad-club-limit";

type SquadCardActionsProps = {
  children: React.ReactNode;
  onMakeCaptain: () => void;
  onRemove: () => void;
  onReplace: (player: DashboardPlayer) => void;
  onSwapPosition: (targetPlayerId: string) => void;
  player: DraftSquadPlayer;
  remainingBudget: number;
  result?: SquadPlayerResult;
  selectedClubIds: string[];
  selectedPlayerIds: string[];
  swapTargets: DraftSquadPlayer[];
  transfersLocked: boolean;
};

const actionButtonClass = "group flex h-11 min-w-0 w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--pf-brand-blue-border)] bg-linear-to-br from-[var(--pf-table-blue)] to-[var(--pf-brand-blue-border)] px-1 text-xs font-bold leading-3 text-white shadow-md transition hover:border-[var(--pf-brand-blue-hover)] hover:brightness-110 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)] disabled:cursor-not-allowed disabled:opacity-60 disabled:transform-none disabled:brightness-100 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm";
const sectionDividerClass = "relative before:pointer-events-none before:absolute before:inset-x-0 before:-top-3 [@media(max-height:640px)]:before:-top-2 before:border-t before:border-[var(--pf-text-muted)]/25 before:content-['']";

function getClubName(player: DashboardPlayer) {
  const name = Array.isArray(player.clubs) ? player.clubs[0]?.name : player.clubs?.name;
  return canonicalClubName(name ?? "Free agent");
}

function getGameweekLabel(result: SquadPlayerResult) {
  return result.round_order !== null
    ? `Gameweek ${result.round_order}`
    : result.gameweek_name.replace(/^round\s*/i, "Gameweek ");
}

export function SquadCardActions({
  children,
  onMakeCaptain,
  onRemove,
  onReplace,
  onSwapPosition,
  player,
  remainingBudget,
  result,
  selectedClubIds,
  selectedPlayerIds,
  swapTargets,
  transfersLocked,
}: SquadCardActionsProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const popupOriginRef = useRef<PopupOrigin | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [swapPickerOpen, setSwapPickerOpen] = useState(false);
  const playerName = `${player.first_name} ${player.last_name}`;
  const clubRepairRequired = getOverLimitClubIds(selectedClubIds).size > 0;
  const playerClubId = (Array.isArray(player.clubs) ? player.clubs[0]?.id : player.clubs?.id) ?? null;
  const transferRestricted = !canTransferFromClub(selectedClubIds, playerClubId);

  useBodyScrollLock(isOpen);

  useLayoutEffect(() => {
    if (isOpen) animatePopupOpen(panelRef.current, triggerRef.current, popupOriginRef.current);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open], [popover]:popover-open")) {
        setSwapPickerOpen(false);
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function closeActions() {
    setSwapPickerOpen(false);
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button
        aria-label={`Open ${result ? "result details" : "actions"} for ${playerName}`}
        aria-expanded={isOpen}
        className={`${squadCardShellClass(player, { isOpen })} touch-manipulation cursor-pointer transition hover:-translate-y-0.5 hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-navy-elevated)] active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-table-blue)]`}
        onClick={(event) => {
          popupOriginRef.current = event.detail ? { x: event.clientX, y: event.clientY } : null;
          setIsOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <div className="flex min-w-0 flex-col items-center">
          {children}
          <span
            aria-hidden="true"
            className="absolute right-2 top-1 text-base leading-none tracking-[-0.16em] text-[var(--pf-text-muted)]/55 transition group-hover:text-[var(--pf-brand-blue-hover)]"
          >
            •••
          </span>
        </div>
      </button>

      {isOpen
        ? createPortal(
            <div
              aria-labelledby={`squad-actions-${player.id}`}
              aria-modal="true"
              className="fixed inset-0 z-[10000] flex items-center justify-center bg-[var(--pf-navy-deep)]/80 p-3 text-white sm:p-4"
              onClick={(event) => {
                if (event.target === event.currentTarget) closeActions();
              }}
              role="dialog"
            >
              <div
                className={`max-h-[calc(100dvh_-_1.5rem)] w-full ${result ? "max-w-md p-5 sm:p-6" : "max-w-2xl p-3 sm:p-5"} overflow-y-auto overscroll-contain rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] shadow-2xl sm:max-h-[calc(100dvh_-_2rem)]`}
                onClick={(event) => event.stopPropagation()}
                ref={panelRef}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <ClubLogo player={player} />
                    <div className="min-w-0">
                      <h2
                        className="text-xl font-bold leading-tight"
                        id={`squad-actions-${player.id}`}
                      >
                        {playerName}
                      </h2>
                      <p className="mt-1 text-sm font-bold text-[var(--pf-text-muted)]">
                        {result
                          ? `${getGameweekLabel(result)} · ${getDisplayedResultPoints(result)} pts`
                          : getClubName(player)}
                      </p>
                    </div>
                  </div>
                  <button
                    aria-label="Close player actions"
                    autoFocus
                    className="touch-manipulation rounded-md px-3 py-1 text-2xl text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                    onClick={closeActions}
                    type="button"
                  >
                    ×
                  </button>
                </div>

                {result ? (
                  <ResultBreakdown result={result} />
                ) : (
                  <>
                    {transfersLocked ? (
                      <div className="mt-5 rounded-md border border-[var(--pf-coral)]/45 bg-[var(--pf-coral-soft)] p-3 text-sm text-[var(--pf-coral-text)]">
                        Player changes are unavailable while the transfer window is
                        closed.
                      </div>
                    ) : null}

                    {clubRepairRequired && !transfersLocked ? (
                      <p className="mt-3 text-sm text-[var(--pf-coral-text)]">
                        {transferRestricted
                          ? "Transfer a player from a club with more than two players first."
                          : "Transfer a player from this club to bring your squad within the club limit."}
                      </p>
                    ) : null}

                    <div className="mt-5 grid gap-3 [@media(max-height:640px)]:mt-3">
                      <div>
                        <h3 className="mb-2 text-left text-xs font-semibold text-[var(--pf-text-muted)] [@media(max-height:640px)]:text-[10px] [@media(max-height:640px)]:leading-3">Team action</h3>
                        <div aria-label="Player actions" className="grid grid-cols-3 gap-2 sm:gap-3" role="group">
                          <button
                            aria-label={
                              player.is_captain
                                ? `${playerName} is already captain`
                                : `Make ${playerName} captain`
                            }
                            className={actionButtonClass}
                            disabled={transfersLocked || clubRepairRequired || player.is_captain}
                            onClick={() => {
                              onMakeCaptain();
                              closeActions();
                            }}
                            type="button"
                          >
                            <PlayerActionIcon kind="captain" className="h-4 w-4 shrink-0 text-[var(--pf-fantasy-yellow)]" />
                            <span>Make captain</span>
                          </button>

                          <PlayerPicker
                            onSelect={(selectedPlayer) => {
                              onReplace(selectedPlayer);
                              closeActions();
                            }}
                            outgoingClubId={
                              Array.isArray(player.clubs)
                                ? player.clubs[0]?.id
                                : player.clubs?.id
                            }
                            outgoingPlayerId={player.id}
                            outgoingPlayer={player}
                            position={player.position}
                            remainingBudget={remainingBudget + Number(player.price)}
                            selectedClubIds={selectedClubIds}
                            selectedPlayerIds={selectedPlayerIds}
                            transfersLocked={transfersLocked}
                            triggerIcon={<PlayerActionIcon kind="transfer" />}
                            triggerClassName={actionButtonClass}
                            trigger="replace"
                            triggerLabel="Transfer player"
                          />

                          <button
                            aria-controls={`swap-picker-${player.id}`}
                            aria-expanded={swapPickerOpen}
                            className={actionButtonClass}
                            disabled={transfersLocked || clubRepairRequired || swapTargets.length === 0}
                            onClick={() => setSwapPickerOpen((open) => !open)}
                            title={
                              swapTargets.length
                                ? undefined
                                : `No ${player.position === "starter" ? "bench" : "main"} players available to swap`
                            }
                            type="button"
                          >
                            <PlayerActionIcon kind="swap" />
                            <span>Swap</span>
                          </button>
                        </div>
                      </div>

                      {swapPickerOpen ? (
                        <div
                          className="rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] p-2"
                          id={`swap-picker-${player.id}`}
                        >
                          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--pf-text-muted)]">
                            Swap with
                          </p>
                          <div className="grid gap-1">
                            {swapTargets.map((target) => (
                              <button
                                className="flex min-h-11 w-full items-center gap-2 rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy)] px-2 py-1 text-left transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                                key={target.id}
                                onClick={() => {
                                  onSwapPosition(target.id);
                                  closeActions();
                                }}
                                type="button"
                              >
                                <ClubLogo player={target} compact />
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-bold leading-4 text-[var(--pf-text)]">
                                    {target.first_name} {target.last_name}
                                  </span>
                                  <span className="block truncate text-[10px] leading-3 text-[var(--pf-text-muted)]">
                                    {getClubName(target)}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <PlayerStatisticsPreview playerId={player.id} className={`mt-6 [@media(max-height:640px)]:mt-4 ${sectionDividerClass}`} />
                    <div aria-label="Player details and removal" className="mt-4 grid grid-cols-[1fr_2fr] gap-2 sm:gap-3 [@media(max-height:640px)]:mt-3" role="group">
                      <button
                        className="flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-lg border border-[var(--pf-coral)]/35 px-2 py-1 text-xs font-semibold leading-tight text-[var(--pf-coral-text)] transition hover:border-[var(--pf-coral)] hover:bg-[var(--pf-coral-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
                        disabled={transfersLocked || transferRestricted}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Remove ${playerName} from your squad?`,
                            )
                          ) {
                            return;
                          }
                          onRemove();
                          closeActions();
                        }}
                        type="button"
                      >
                        <PlayerActionIcon kind="remove" className="hidden h-4 w-4 shrink-0 sm:block" />
                        <span>Remove player</span>
                      </button>
                      <PlayerStatisticsButton player={player} className="group flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] px-3 py-1 text-xs font-bold leading-tight text-[var(--pf-text)] min-[360px]:text-sm transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-navy-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)] sm:px-4">
                        <span className="min-w-0 text-left">Full player statistics</span>
                        <PlayerActionIcon kind="arrow" className="h-5 w-5 shrink-0 transition-transform motion-safe:group-hover:translate-x-0.5" />
                      </PlayerStatisticsButton>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

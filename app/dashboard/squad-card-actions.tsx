"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PlayerPicker } from "@/app/dashboard/player-picker";
import type {
  DashboardPlayer,
  DraftSquadPlayer,
} from "@/app/dashboard/player-types";

type SquadCardActionsProps = {
  children: React.ReactNode;
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
};

export function SquadCardActions({
  children,
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
}: SquadCardActionsProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const playerName = `${player.first_name} ${player.last_name}`;
  const canReplacePlayer = selectedPlayerIds.length >= 6;

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function closeActions() {
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button
        aria-label={`Open actions for ${playerName}`}
        aria-expanded={isOpen}
        className={`group relative min-w-0 w-full max-w-52 touch-manipulation cursor-pointer overflow-hidden rounded-lg border bg-[var(--pf-navy)] px-2 py-3 text-center shadow-lg shadow-[var(--pf-navy-deep)]/30 transition hover:-translate-y-0.5 hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-navy-elevated)] active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-table-blue)] sm:px-4 sm:py-4 ${
          isOpen
            ? "border-[var(--pf-brand-blue)] ring-2 ring-[var(--pf-brand-blue)]/35"
            : player.active === false
              ? "border-[var(--pf-coral)]"
              : player.is_captain
                ? "border-[var(--pf-fantasy-yellow)]/70"
                : "border-[var(--pf-card-border)]"
        }`}
        onClick={() => setIsOpen(true)}
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
              className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--pf-navy-deep)]/80 p-4 text-white"
              onClick={(event) => {
                if (event.target === event.currentTarget) closeActions();
              }}
              role="dialog"
            >
              <div
                className="max-h-[calc(100dvh_-_2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-5 shadow-2xl sm:p-6"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--pf-brand-blue)]">
                      Player actions
                    </p>
                    <h2
                      className="mt-1 text-xl font-bold"
                      id={`squad-actions-${player.id}`}
                    >
                      {playerName}
                    </h2>
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

                {transfersLocked ? (
                  <div className="mt-5 rounded-md border border-[var(--pf-coral)]/45 bg-[var(--pf-coral-soft)] p-3 text-sm text-[var(--pf-coral-text)]">
                    Player changes are unavailable while the transfer window is
                    closed.
                  </div>
                ) : null}

                <div className="mt-5 grid gap-3">
                  {!player.is_captain ? (
                    <button
                      className="h-12 w-full rounded-md border border-[var(--pf-fantasy-yellow)]/50 bg-[var(--pf-fantasy-yellow)]/10 px-4 text-sm font-semibold text-[#ffe8a3] transition hover:border-[var(--pf-fantasy-yellow)] hover:bg-[var(--pf-fantasy-yellow)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-fantasy-yellow)] disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={transfersLocked}
                      onClick={() => {
                        onMakeCaptain();
                        closeActions();
                      }}
                      type="button"
                    >
                      Make captain
                    </button>
                  ) : (
                    <div className="flex h-12 items-center justify-center rounded-md border border-[var(--pf-fantasy-yellow)]/45 bg-[var(--pf-fantasy-yellow)]/10 px-4 text-center text-sm font-semibold text-[#ffe8a3]">
                      Current captain
                    </div>
                  )}

                  {swapTargets.length ? (
                    <select
                      aria-label="Player to swap position with"
                      className="h-12 w-full min-w-0 rounded-md border border-white/20 bg-white/5 px-4 text-sm font-semibold text-sky-50 outline-none hover:border-white/60 hover:bg-white/10 focus:border-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
                      defaultValue=""
                      disabled={transfersLocked}
                      onChange={(event) => {
                        onSwapPosition(event.target.value);
                        closeActions();
                      }}
                    >
                      <option disabled value="">
                        {player.position === "starter"
                          ? "Swap with a bench player…"
                          : "Swap with a main player…"}
                      </option>
                      {swapTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.first_name} {target.last_name}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {canReplacePlayer ? (
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
                      position={player.position}
                      remainingBudget={remainingBudget + Number(player.price)}
                      selectedClubIds={selectedClubIds}
                      selectedPlayerIds={selectedPlayerIds}
                      transfersLocked={transfersLocked}
                      trigger="replace"
                    />
                  ) : null}

                  <button
                    className="h-12 w-full rounded-md border border-[var(--pf-coral)]/55 bg-[var(--pf-coral-soft)] px-4 text-sm font-semibold text-[var(--pf-coral-text)] transition hover:border-[var(--pf-coral)] hover:bg-[var(--pf-coral)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-coral)] disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={transfersLocked}
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
                    Remove from squad
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

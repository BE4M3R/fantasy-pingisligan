"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getClubLogo } from "@/app/dashboard/club-logos";
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

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
}

function getClubName(player: DashboardPlayer) {
  return Array.isArray(player.clubs)
    ? player.clubs[0]?.name ?? "Free agent"
    : player.clubs?.name ?? "Free agent";
}

function ClubLogo({ player }: { player: DashboardPlayer }) {
  const clubName = getClubName(player);
  const logo = getClubLogo(clubName);

  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[var(--pf-text)] p-1.5">
      {logo ? (
        <Image
          alt={logo.alt}
          className="h-auto w-auto max-h-12 max-w-12 object-contain"
          height={48}
          src={logo.src}
          width={48}
        />
      ) : (
        <span className="text-base font-black text-[var(--pf-navy)]">
          {clubName.slice(0, 1)}
        </span>
      )}
    </div>
  );
}

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
  const [swapPickerOpen, setSwapPickerOpen] = useState(false);
  const playerName = `${player.first_name} ${player.last_name}`;

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSwapPickerOpen(false);
        setIsOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
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
                        {formatMoney(player.price)}
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

                {transfersLocked ? (
                  <div className="mt-5 rounded-md border border-[var(--pf-coral)]/45 bg-[var(--pf-coral-soft)] p-3 text-sm text-[var(--pf-coral-text)]">
                    Player changes are unavailable while the transfer window is
                    closed.
                  </div>
                ) : null}

                <div className="mt-5 grid gap-3">
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <button
                      aria-label={
                        player.is_captain
                          ? `${playerName} is already captain`
                          : `Make ${playerName} captain`
                      }
                      className="h-12 w-full rounded-md bg-[var(--pf-brand-blue)] px-2 text-xs font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)] disabled:cursor-not-allowed disabled:bg-[var(--pf-navy-elevated)] disabled:text-[var(--pf-text-muted)] disabled:opacity-60 sm:text-sm"
                      disabled={transfersLocked || player.is_captain}
                      onClick={() => {
                        onMakeCaptain();
                        closeActions();
                      }}
                      type="button"
                    >
                      Make captain
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
                      position={player.position}
                      remainingBudget={remainingBudget + Number(player.price)}
                      selectedClubIds={selectedClubIds}
                      selectedPlayerIds={selectedPlayerIds}
                      transfersLocked={transfersLocked}
                      trigger="replace"
                      triggerLabel="Transfer player"
                    />

                    <button
                      aria-controls={`swap-picker-${player.id}`}
                      aria-expanded={swapPickerOpen}
                      className="h-12 w-full rounded-md bg-[var(--pf-brand-blue)] px-2 text-xs font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)] disabled:cursor-not-allowed disabled:bg-[var(--pf-navy-elevated)] disabled:text-[var(--pf-text-muted)] disabled:opacity-60 sm:text-sm"
                      disabled={transfersLocked || swapTargets.length === 0}
                      onClick={() => setSwapPickerOpen((open) => !open)}
                      title={
                        swapTargets.length
                          ? undefined
                          : `No ${player.position === "starter" ? "bench" : "main"} players available to swap`
                      }
                      type="button"
                    >
                      Swap
                    </button>
                  </div>

                  {swapPickerOpen ? (
                    <div
                      className="rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] p-3"
                      id={`swap-picker-${player.id}`}
                    >
                      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--pf-text-muted)]">
                        Swap with
                      </p>
                      <div className="grid gap-2">
                        {swapTargets.map((target) => (
                          <button
                            className="flex w-full items-center gap-3 rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-2 text-left transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                            key={target.id}
                            onClick={() => {
                              onSwapPosition(target.id);
                              closeActions();
                            }}
                            type="button"
                          >
                            <ClubLogo player={target} />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold text-[var(--pf-text)]">
                                {target.first_name} {target.last_name}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-[var(--pf-text-muted)]">
                                {getClubName(target)}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <button
                    className="mx-auto mt-1 rounded-md border border-white/60 px-3 py-2 text-xs font-semibold text-[var(--pf-text-muted)] transition hover:border-white hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] disabled:cursor-not-allowed disabled:opacity-40"
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
                    Remove from team
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

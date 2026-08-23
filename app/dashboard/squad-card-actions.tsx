"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getClubLogo } from "@/app/dashboard/club-logos";
import { PlayerPicker } from "@/app/dashboard/player-picker";
import type {
  DashboardPlayer,
  DraftSquadPlayer,
  SquadPlayerResult,
} from "@/app/dashboard/player-types";
import {
  getDisplayedResultPoints,
  hasPlayedMatch,
} from "@/app/dashboard/player-types";
import { useBodyScrollLock } from "@/app/dashboard/use-body-scroll-lock";

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

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
}

function getClubName(player: DashboardPlayer) {
  return Array.isArray(player.clubs)
    ? player.clubs[0]?.name ?? "Free agent"
    : player.clubs?.name ?? "Free agent";
}

function formatPoints(value: number) {
  return `${value > 0 ? "+" : ""}${value} pts`;
}

function getGameweekLabel(result: SquadPlayerResult) {
  return result.round_order !== null
    ? `Gameweek ${result.round_order}`
    : result.gameweek_name.replace(/^round\s*/i, "Gameweek ");
}

function ResultBreakdown({ result }: { result: SquadPlayerResult }) {
  const playedMatch = hasPlayedMatch(result);
  const displayedPoints = getDisplayedResultPoints(result);
  const rows = [
    {
      detail: `${result.singles_wins} won, ${result.singles_losses} lost`,
      label: "Singles wins",
      points: result.singles_wins * 4,
      show: result.singles_wins + result.singles_losses > 0,
    },
    {
      detail: `${result.doubles_wins} won, ${result.doubles_losses} lost`,
      label: "Doubles wins",
      points: result.doubles_wins * 2,
      show: result.doubles_wins + result.doubles_losses > 0,
    },
    ...(result.set_breakdown_available
      ? [
          {
            detail: `${result.singles_sets_won} won, ${result.singles_sets_lost} lost`,
            label: "Singles set points",
            points: result.singles_set_points,
            show: result.singles_sets_won + result.singles_sets_lost > 0,
          },
          {
            detail: `${result.doubles_sets_won} won, ${result.doubles_sets_lost} lost`,
            label: "Doubles set points",
            points: result.doubles_set_points,
            show: result.doubles_sets_won + result.doubles_sets_lost > 0,
          },
        ]
      : [
          {
            detail: `${result.sets_won} won, ${result.sets_lost} lost`,
            label: "Set points",
            points: result.set_points,
            show: result.sets_won + result.sets_lost > 0,
          },
        ]),
    {
      detail: `${result.fixture_win_points / 3} fixture ${result.fixture_win_points === 3 ? "win" : "wins"}`,
      label: "Fixture wins",
      points: result.fixture_win_points,
      show: result.fixture_win_points !== 0,
    },
    {
      detail: "Won every singles match (minimum two)",
      label: "Singles sweep bonus",
      points: result.sweep_bonus_points,
      show: result.sweep_bonus_points !== 0,
    },
  ].filter((row) => row.show);

  return (
    <div className="mt-5">
      <div className="rounded-lg bg-[var(--pf-navy-elevated)] p-3">
        <p className="text-[0.65rem] font-bold uppercase tracking-wide text-[var(--pf-text-muted)]">
          Total points
        </p>
        <p className="mt-1 text-2xl font-black text-[var(--pf-fantasy-yellow)]">
          {displayedPoints}
        </p>
        {displayedPoints === 0 ? (
          <p className="mt-1 text-xs font-bold text-[var(--pf-text-muted)]">
            {playedMatch ? "Played this gameweek" : "Did not play this gameweek"}
          </p>
        ) : null}
      </div>

      <h3 className="mt-5 text-xs font-black uppercase tracking-[0.14em] text-[var(--pf-brand-blue-hover)]">
        Points breakdown
      </h3>
      {rows.length ? (
        <dl className="mt-2 divide-y divide-[var(--pf-card-border)] rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3">
          {rows.map((row) => (
            <div className="flex items-center justify-between gap-4 py-3" key={row.label}>
              <div className="min-w-0">
                <dt className="text-sm font-bold text-[var(--pf-text)]">
                  {row.label}
                </dt>
                <dd className="mt-0.5 text-xs text-[var(--pf-text-muted)]">
                  {row.detail}
                </dd>
              </div>
              <dd
                className={`shrink-0 text-sm font-black ${
                  row.points < 0
                    ? "text-[var(--pf-coral-text)]"
                    : "text-[var(--pf-text)]"
                }`}
              >
                {formatPoints(row.points)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-3 text-sm text-[var(--pf-text-muted)]">
          {playedMatch
            ? "Played, but earned no scoring points."
            : "Did not play this gameweek."}
        </p>
      )}

      {result.is_captain ? (
        <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-[var(--pf-fantasy-yellow)]/45 bg-[var(--pf-navy-elevated)] p-3">
          <div>
            <p className="text-sm font-bold text-[var(--pf-fantasy-yellow)]">
              {result.active_chip === "triple_captain"
                ? "Triple Captain"
                : "Captain"}
            </p>
            <p className="mt-0.5 text-xs text-[var(--pf-text-muted)]">
              {result.active_chip === "triple_captain"
                ? "Player points counted three times"
                : "Player points counted twice"}
            </p>
          </div>
          <p className="shrink-0 text-sm font-black text-[var(--pf-fantasy-yellow)]">
            {formatPoints(result.captain_bonus_points)}
          </p>
        </div>
      ) : null}

      {result.position === "bench" ? (
        <div className="mt-3 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] p-3">
          <p className="text-sm font-bold text-[var(--pf-text)]">
            {result.active_chip === "bench_boost"
              ? "Bench Boost active"
              : "Bench points not counted"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--pf-text-muted)]">
            {result.active_chip === "bench_boost"
              ? `${result.fantasy_points} bench points included in the team total.`
              : `${result.fantasy_points} player points earned, with no Bench Boost active.`}
          </p>
        </div>
      ) : null}
    </div>
  );
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
  result,
  selectedClubIds,
  selectedPlayerIds,
  swapTargets,
  transfersLocked,
}: SquadCardActionsProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [swapPickerOpen, setSwapPickerOpen] = useState(false);
  const playerName = `${player.first_name} ${player.last_name}`;

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
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
        className={`group relative min-w-0 w-full max-w-52 touch-manipulation cursor-pointer overflow-hidden rounded-lg border bg-[var(--pf-navy)] px-2 py-2.5 text-center shadow-lg shadow-[var(--pf-navy-deep)]/30 transition hover:-translate-y-0.5 hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-navy-elevated)] active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-table-blue)] sm:px-4 sm:py-3 ${
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
                        {result
                          ? `${getGameweekLabel(result)} · ${getDisplayedResultPoints(result)} pts`
                          : formatMoney(player.price)}
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

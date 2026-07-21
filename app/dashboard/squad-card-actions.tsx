"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  removePlayerFromTeam,
  setTeamCaptain,
  swapSquadPlayers,
} from "@/app/dashboard/actions";
import { PlayerPicker } from "@/app/dashboard/player-picker";
import type { SquadPlayerOption } from "@/app/dashboard/player-types";

type SquadCardActionsProps = {
  children: React.ReactNode;
  player: SquadPlayerOption & { is_captain: boolean };
  remainingBudget: number;
  selectedPlayerIds: string[];
  swapTargets: SquadPlayerOption[];
  transfersLocked: boolean;
};

export function SquadCardActions({
  children,
  player,
  remainingBudget,
  selectedPlayerIds,
  swapTargets,
  transfersLocked,
}: SquadCardActionsProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const playerName = `${player.first_name} ${player.last_name}`;

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

  function openActions() {
    setIsOpen(true);
  }

  return (
    <>
      <button
        aria-label={`Open actions for ${playerName}`}
        className="group h-28 min-w-0 w-full touch-manipulation cursor-pointer overflow-hidden rounded-md border border-white/15 bg-sky-950/70 p-4 text-left shadow-sm shadow-slate-950/20 transition hover:border-sky-100/60 hover:bg-sky-900/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-100"
        onClick={openActions}
        ref={triggerRef}
        type="button"
      >
        <div className="flex items-start justify-between gap-3">
          {children}
          <span aria-hidden="true" className="text-xl leading-none text-sky-100/40 transition group-hover:text-sky-100">•••</span>
        </div>
      </button>

      {isOpen
        ? createPortal(
          <div
            aria-labelledby={`squad-actions-${player.id}`}
            aria-modal="true"
            className="fixed inset-0 z-[100] flex items-end bg-slate-950/75 text-white sm:items-center sm:justify-center sm:p-4"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeActions();
            }}
            role="dialog"
          >
          <div
            className="max-h-[calc(100dvh_-_1rem)] w-full overflow-y-auto rounded-t-xl border border-white/15 bg-sky-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-sky-200/60">Player actions</p>
                <h2 className="mt-1 text-xl font-bold" id={`squad-actions-${player.id}`}>{playerName}</h2>
              </div>
              <button aria-label="Close player actions" autoFocus className="touch-manipulation rounded-md px-3 py-1 text-2xl text-sky-100/60 hover:bg-white/10 hover:text-white" onClick={closeActions} type="button">×</button>
            </div>

            {transfersLocked ? (
              <div className="mt-5 rounded-md border border-red-300/30 bg-red-400/10 p-3 text-sm text-red-100">
                Player changes are unavailable while the transfer window is closed.
              </div>
            ) : null}

            <div className="mt-5 grid gap-3">
              {!player.is_captain ? (
                <form action={setTeamCaptain}>
                  <input name="player_id" type="hidden" value={player.id} />
                  <button className="w-full rounded-md border border-sky-200/30 bg-sky-200/10 px-4 py-3 text-sm font-semibold text-sky-50 transition hover:border-sky-100 hover:bg-sky-100/15 disabled:cursor-not-allowed disabled:opacity-40" disabled={transfersLocked}>
                    Make captain
                  </button>
                </form>
              ) : (
                <div className="rounded-md border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-center text-sm font-semibold text-emerald-100">Current captain</div>
              )}

              {swapTargets.length ? (
                <form action={swapSquadPlayers} className="grid grid-cols-[1fr_auto] gap-2">
                  <input name="player_id" type="hidden" value={player.id} />
                  <select aria-label="Player to swap position with" className="min-w-0 rounded-md border border-white/15 bg-sky-950 px-3 py-3 text-sm font-semibold text-sky-50 outline-none focus:border-sky-100 disabled:cursor-not-allowed disabled:opacity-40" defaultValue="" disabled={transfersLocked} name="target_player_id" required>
                    <option disabled value="">Swap main/bench with…</option>
                    {swapTargets.map((target) => <option key={target.id} value={target.id}>{target.first_name} {target.last_name}</option>)}
                  </select>
                  <button className="rounded-md border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold hover:border-white/60 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={transfersLocked}>Swap</button>
                </form>
              ) : null}

              {swapTargets.length ? (
                <PlayerPicker outgoingPlayerId={player.id} position={player.position} remainingBudget={remainingBudget + Number(player.price)} selectedPlayerIds={selectedPlayerIds} transfersLocked={transfersLocked} trigger="replace" />
              ) : null}

              <form
                action={removePlayerFromTeam}
                onSubmit={(event) => {
                  if (!window.confirm(`Remove ${playerName} from your squad?`)) event.preventDefault();
                }}
              >
                <input name="player_id" type="hidden" value={player.id} />
                <button className="w-full rounded-md border border-red-300/35 bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:border-red-200 hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40" disabled={transfersLocked}>
                  Remove from squad
                </button>
              </form>
            </div>
          </div>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DashboardPlayer } from "@/app/dashboard/player-types";
import { PlayerStatisticsContent } from "@/app/dashboard/player-statistics";
import { usePlayerStatistics } from "@/app/dashboard/use-player-statistics";
import { useBodyScrollLock } from "@/app/dashboard/use-body-scroll-lock";

export function PlayerStatisticsButton({ player, children, className }: {
  player: DashboardPlayer;
  children?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button aria-label={`View statistics for ${player.first_name} ${player.last_name}`} aria-haspopup="dialog" className={className ?? "mt-4 min-h-11 w-full rounded-md border border-[var(--pf-brand-blue-border)] px-3 py-2 text-sm font-semibold text-[var(--pf-brand-blue-hover)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"} onClick={() => setOpen(true)} type="button">{children ?? "View player statistics"}</button>
    {open ? <PlayerStatisticsDialog player={player} onClose={() => setOpen(false)} /> : null}
  </>;
}

export function PlayerStatisticsDialog({ player, onClose }: { player: DashboardPlayer; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { statistics, error, load } = usePlayerStatistics(player.id, true);
  useBodyScrollLock(true);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return <dialog aria-labelledby={titleId} className="m-auto h-[100dvh] max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-[var(--pf-text)] backdrop:bg-[var(--pf-navy-deep)]/80 sm:h-auto sm:max-h-[90dvh] sm:w-[min(48rem,calc(100%-2rem))] sm:rounded-xl" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }} ref={dialog}>
      <div className="relative flex h-full max-h-[100dvh] flex-col border border-[var(--pf-card-border)] bg-[var(--pf-navy)] sm:max-h-[90dvh] sm:rounded-xl">
          <h2 className="sr-only" id={titleId}>{player.first_name} {player.last_name} statistics</h2>
          <button aria-label="Close player statistics" autoFocus className="absolute right-2 top-2 z-10 h-11 w-11 rounded-md bg-[var(--pf-navy)] text-2xl text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] sm:right-3 sm:top-3" onClick={() => dialog.current?.close()} type="button">×</button>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
          {!statistics && !error ? <p className="py-16 text-center text-sm text-[var(--pf-text-muted)]" role="status">Loading player statistics…</p> : null}
          {error ? <div className="mb-4 rounded-md bg-[var(--pf-coral-soft)] p-4 pr-14 text-sm text-[var(--pf-coral-text)]" role="alert"><p>{error}</p><button className="mt-3 min-h-11 rounded-md border border-current px-3 font-semibold" onClick={() => void load()} type="button">Try again</button></div> : null}
          {statistics ? <PlayerStatisticsContent statistics={statistics} /> : null}
        </div>
      </div>
    </dialog>;
}

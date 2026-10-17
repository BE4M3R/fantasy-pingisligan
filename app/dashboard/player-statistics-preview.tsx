"use client";

import { PlayerStatisticsHighlights } from "@/app/dashboard/player-statistics";
import { usePlayerStatistics } from "@/app/dashboard/use-player-statistics";

// Mounted only while the squad actions popup is open. The full statistics
// dialog shares this request and its bounded, short-lived public-data cache.
export function PlayerStatisticsPreview({ playerId, className = "mt-3" }: { playerId: string; className?: string }) {
  const { statistics, error, load } = usePlayerStatistics(playerId, true);

  return <section aria-label="Player overview" className={className}>
    <h3 className="mb-2 text-left text-xs font-semibold text-[var(--pf-text-muted)] [@media(max-height:640px)]:text-[10px] [@media(max-height:640px)]:leading-3">Player overview</h3>
    {!statistics && !error ? <p className="py-4 text-center text-sm text-[var(--pf-text-muted)]" role="status">Loading player statistics…</p> : null}
    {error ? <div className="mb-3 rounded-md bg-[var(--pf-coral-soft)] p-3 text-sm text-[var(--pf-coral-text)]" role="alert">
      <p>{error}</p>
      <button className="mt-2 min-h-11 rounded-md border border-current px-3 font-semibold" onClick={() => void load()} type="button">Try again</button>
    </div> : null}
    {statistics ? <PlayerStatisticsHighlights statistics={statistics} /> : null}
  </section>;
}

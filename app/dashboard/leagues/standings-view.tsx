"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Week = { gameweek_id: string; gameweek_number: number; state: string };

export function StandingsView({ basePath, gameweekMode, weeks, selectedId }: {
  basePath: string; gameweekMode: boolean; weeks: Week[]; selectedId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = (mode: string, id = selectedId) => `${basePath}?view=${mode}${id ? `&gameweek=${encodeURIComponent(id)}` : ""}`;
  const index = weeks.findIndex((week) => week.gameweek_id === selectedId);
  const selectedWeek = weeks[index];
  // Metadata is newest first: left goes older, right goes newer.
  const previous = weeks[index + 1];
  const next = weeks[index - 1];
  const arrowClass = "flex h-11 w-11 items-center justify-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] disabled:cursor-not-allowed disabled:border-[var(--pf-card-border)] disabled:text-[var(--pf-text-muted)]/35 disabled:hover:bg-[var(--pf-navy-elevated)]";
  function navigate(id: string) {
    startTransition(() => router.push(href("gameweek", id), { scroll: false }));
  }
  return <div aria-busy={pending}>
    <nav aria-label="Standings view" className="mx-auto grid w-full max-w-sm grid-cols-2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] p-1">
      {(["global", "gameweek"] as const).map((mode) => {
        const selected = gameweekMode === (mode === "gameweek");
        return <Link key={mode} href={href(mode)} aria-current={selected ? "page" : undefined}
          className={`flex min-h-10 items-center justify-center rounded-md px-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] ${selected ? "bg-[var(--pf-brand-blue)] text-[var(--pf-text)]" : "text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-text)]"}`}>
          {mode === "global" ? "Season" : "Gameweek"}
        </Link>;
      })}
    </nav>
    {gameweekMode && selectedWeek ? <nav aria-label="Standings Gameweeks" aria-busy={pending}
      className="mx-auto mt-4 grid w-full max-w-sm grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] p-2">
      <button type="button" className={arrowClass} disabled={!previous || pending}
        aria-label={previous ? `Previous: Gameweek ${previous.gameweek_number}` : "No previous Gameweek"}
        onClick={() => previous && navigate(previous.gameweek_id)}><span aria-hidden="true" className="text-2xl leading-none">‹</span></button>
      <div className="min-w-0 text-center" aria-live="polite">
        <p className="text-sm font-black text-[var(--pf-text)]">Gameweek {selectedWeek.gameweek_number}</p>
        <p className="mt-0.5 text-xs text-[var(--pf-text-muted)]">{pending ? "Loading Gameweek…" : selectedWeek.state === "open" || selectedWeek.state === "upcoming" ? "Not started" : selectedWeek.state === "previous" ? "Provisional results" : "In progress · Provisional"}</p>
      </div>
      <button type="button" className={arrowClass} disabled={!next || pending}
        aria-label={next ? `Next: Gameweek ${next.gameweek_number}` : "No next Gameweek"}
        onClick={() => next && navigate(next.gameweek_id)}><span aria-hidden="true" className="text-2xl leading-none">›</span></button>
    </nav> : null}
  </div>;
}

import type { CompetitionWinner } from "@/lib/competitions";

function CornerConfetti({ className }: { className: string }) {
  return <svg aria-hidden="true" viewBox="0 0 100 100" fill="none" className={`pointer-events-none absolute h-20 w-20 opacity-70 sm:h-28 sm:w-28 ${className}`}>
    <g fill="var(--pf-logo-gold)">
      <rect x="12" y="12" width="6" height="13" rx="1" transform="rotate(-28 15 18)" />
      <rect x="68" y="16" width="5" height="10" rx="1" transform="rotate(35 70 21)" />
      <circle cx="14" cy="70" r="3" />
    </g>
    <g fill="var(--pf-brand-blue-hover)">
      <rect x="22" y="43" width="7" height="7" rx="1" transform="rotate(24 25 46)" />
      <rect x="79" y="60" width="4" height="9" rx="1" transform="rotate(-22 81 65)" />
      <circle cx="49" cy="14" r="3" />
    </g>
    <g stroke="var(--pf-logo-gold)" strokeWidth="2.5" strokeLinecap="round">
      <path d="M41 43c8-6 13 6 5 10s-3 11 3 10M5 91l8-6m-4 11 8-6" />
    </g>
    <g fill="var(--pf-text)" opacity=".65">
      <circle cx="7" cy="37" r="2" /><circle cx="89" cy="38" r="2" />
      <rect x="35" y="79" width="3" height="7" rx="1" transform="rotate(40 36 82)" />
    </g>
  </svg>;
}

export function WinnerAnnouncement({ winner, error = false }: { winner: CompetitionWinner | null; error?: boolean }) {
  return <section aria-labelledby="winner-heading"
    className={`relative isolate overflow-hidden rounded-2xl border border-[var(--pf-logo-gold)]/50 bg-[var(--pf-navy)] ${winner ? "px-6 py-8 text-center sm:px-12 sm:py-10" : "p-5 sm:p-7"}`}
    style={winner ? { backgroundImage: "radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--pf-logo-gold) 14%, transparent), transparent 75%)" } : undefined}>
    {winner ? <>
      <CornerConfetti className="left-0 top-0" />
      <CornerConfetti className="right-0 top-0 -scale-x-100" />
      <CornerConfetti className="bottom-0 left-0 -scale-y-100" />
      <CornerConfetti className="bottom-0 right-0 rotate-180" />
    </> : null}
    <div className="relative z-10 mx-auto min-w-0 max-w-2xl">
        <h2 id="winner-heading" className="text-xs font-bold uppercase tracking-widest text-[var(--pf-logo-gold)]">{winner ? "Gameweek winner" : "Winner announcement"}</h2>
        {winner ? <>
          <p className="mt-3 break-words text-3xl font-black leading-tight sm:text-4xl">{winner.team_name}</p>
          <p className="mt-4 text-lg font-bold text-[var(--pf-logo-gold)]">Congratulations!</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--pf-text-muted)]">The winner will be contacted at their registered email address with prize claim details.</p>
        </> : <p className="mt-2 text-sm leading-6 text-[var(--pf-text-muted)]" role={error ? "status" : undefined}>{error ? "Winner announcements are temporarily unavailable. Please try again." : "Results are being reviewed. The confirmed winner will be announced here."}</p>}
    </div>
  </section>;
}

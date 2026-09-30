type NavigationAction = {
  label: string;
  onClick?: () => void;
};

export function GameweekResultNavigation({
  ariaLabel,
  className = "",
  label,
  loading = false,
  next,
  placeholder = false,
  pointsText,
  previous,
  transferPenalty,
}: {
  ariaLabel: string;
  className?: string;
  label: string;
  loading?: boolean;
  next?: NavigationAction;
  placeholder?: boolean;
  pointsText: string;
  previous?: NavigationAction;
  transferPenalty: number | null;
}) {
  const buttonClass = "flex h-11 w-11 items-center justify-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] disabled:cursor-not-allowed disabled:border-[var(--pf-card-border)] disabled:text-[var(--pf-text-muted)]/35 disabled:hover:bg-[var(--pf-navy-elevated)]";

  return (
    <nav
      aria-label={ariaLabel}
      aria-busy={loading}
      className={`mx-auto grid w-full max-w-sm grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] p-2 ${className}`}
    >
      <button
        aria-label={previous?.label ?? "No previous gameweek"}
        className={buttonClass}
        disabled={!previous?.onClick || loading}
        onClick={previous?.onClick}
        type="button"
      >
        <span aria-hidden="true" className="text-2xl leading-none">‹</span>
      </button>

      {placeholder ? (
        <div aria-hidden="true" className="flex min-w-0 flex-col items-center gap-1">
          <div className="h-3 w-24 rounded bg-[var(--pf-navy-elevated)]" />
          <div className="h-6 w-16 rounded bg-[var(--pf-navy-elevated)]" />
          <div className="h-4 w-28 rounded bg-[var(--pf-navy-elevated)]" />
        </div>
      ) : (
        <div className="min-w-0 text-center">
          <p className="truncate text-[0.65rem] font-black uppercase tracking-[0.14em] text-[var(--pf-text-muted)]">{label}</p>
          <p className="mt-0.5 text-xl font-black text-[var(--pf-fantasy-yellow)]">{pointsText} pts</p>
          <p className="mt-0.5 min-h-4 text-[0.65rem] leading-4 text-[var(--pf-text-muted)]">
            {loading
              ? "Loading gameweek…"
              : transferPenalty === null
                ? "Transfer cost unavailable"
                : transferPenalty !== 0
                  ? `Includes ${transferPenalty} pts transfer cost`
                  : "No transfer cost"}
          </p>
        </div>
      )}

      <button
        aria-label={next?.label ?? "No next gameweek"}
        className={buttonClass}
        disabled={!next?.onClick || loading}
        onClick={next?.onClick}
        type="button"
      >
        <span aria-hidden="true" className="text-2xl leading-none">›</span>
      </button>
    </nav>
  );
}

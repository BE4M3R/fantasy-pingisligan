export type ProgressRow = {
  gameweek_id: string;
  gameweek_name: string;
  round_order: number | null;
  first_match_starts_at: string;
  last_match_ends_at: string;
  points: number | string;
  average_points: number | string;
  max_points: number | string;
};

function formatPoints(value: number | string, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits }).format(
    Number(value),
  );
}

function getGameweekLabel(row: ProgressRow) {
  if (row.round_order !== null) {
    return `GW ${row.round_order}`;
  }

  return row.gameweek_name.replace(/^round\s*/i, "GW ");
}

export function ProgressTable({ rows }: { rows: ProgressRow[] }) {
  return (
    <section aria-labelledby="played-gameweeks-title" className="mt-5">
      <h2
        className="text-base font-black text-[var(--pf-text)]"
        id="played-gameweeks-title"
      >
        Played gameweeks
      </h2>

      <div className="mt-3 overflow-hidden rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)]">
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(3.5rem,0.55fr))] gap-2 border-b border-[var(--pf-card-border)] bg-[var(--pf-navy-deep)] px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-[var(--pf-text-muted)] sm:grid-cols-[minmax(0,1fr)_repeat(3,7rem)] sm:px-4">
          <span className="text-left">Gameweek(GW)</span>
          <span>Your points</span>
          <span>Average</span>
          <span>Max</span>
        </div>

        {rows.length ? (
          <div className="divide-y divide-[var(--pf-card-border)]">
            {rows.map((row) => (
              <article
                className="grid min-h-12 grid-cols-[minmax(0,1fr)_repeat(3,minmax(3.5rem,0.55fr))] items-center gap-2 px-3 py-2 text-right text-sm transition hover:bg-[var(--pf-brand-blue-soft)] sm:grid-cols-[minmax(0,1fr)_repeat(3,7rem)] sm:px-4"
                key={row.gameweek_id}
              >
                <h3 className="truncate text-left font-bold text-[var(--pf-text)]">
                  {getGameweekLabel(row)}
                </h3>
                <p className="font-black text-[var(--pf-fantasy-yellow)]">
                  {formatPoints(row.points)}
                </p>
                <p className="font-semibold text-[var(--pf-text)]">
                  {formatPoints(row.average_points, 1)}
                </p>
                <p className="font-semibold text-[var(--pf-text)]">
                  {formatPoints(row.max_points)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="px-4 py-6 text-sm text-[var(--pf-text-muted)]">
            No played gameweeks yet.
          </p>
        )}
      </div>
    </section>
  );
}

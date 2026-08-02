export type ProgressRow = {
  gameweek_id: string;
  gameweek_name: string;
  round_order: number | null;
  first_match_starts_at: string;
  last_match_ends_at: string;
  lock_at: string;
  unlock_at: string;
  status: string;
  points: number | string;
  active_chip?: string | null;
  transfer_count_at_lock?: number | null;
  transfer_penalty_points?: number | null;
};

const chipLabels: Record<string, string> = {
  bench_boost: "Bench Boost",
  triple_captain: "Triple Captain",
  wildcard: "Wildcard",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));
}

function formatPoints(value: number | string) {
  return new Intl.NumberFormat("sv-SE").format(Number(value));
}

function formatTransferPenalty(row: ProgressRow) {
  if (!row.transfer_penalty_points) {
    return null;
  }

  return `${row.transfer_count_at_lock} transfers, ${formatPoints(row.transfer_penalty_points)} pts`;
}

function formatMatchDates(row: ProgressRow) {
  const firstDate = formatDate(row.first_match_starts_at);
  const lastDate = formatDate(row.last_match_ends_at);

  return row.first_match_starts_at === row.last_match_ends_at
    ? firstDate
    : `${firstDate} – ${lastDate}`;
}

function getStatusClass(status: string) {
  if (status === "Complete") {
    return "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  }

  if (status === "In progress") {
    return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  }

  return "border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] text-[var(--pf-brand-blue-hover)]";
}

export function ProgressTable({ rows }: { rows: ProgressRow[] }) {
  return (
    <>
      <div className="mt-5 space-y-3 md:hidden">
        {rows.length ? (
          rows.map((row) => (
            <article
              className="rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-4"
              key={row.gameweek_id}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate font-bold text-[var(--pf-text)]">
                    {row.gameweek_name}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--pf-text-muted)]">
                    {formatMatchDates(row)}
                  </p>
                  {row.active_chip ? (
                    <p className="mt-2 text-xs font-semibold text-[var(--pf-fantasy-yellow)]">
                      {chipLabels[row.active_chip] ?? row.active_chip}
                    </p>
                  ) : null}
                  {formatTransferPenalty(row) ? (
                    <p className="mt-1 text-xs font-semibold text-amber-100">
                      {formatTransferPenalty(row)}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xl font-black text-[var(--pf-text)]">
                    {formatPoints(row.points)}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--pf-text-muted)]">
                    Points
                  </p>
                </div>
              </div>
              <div className="mt-4 border-t border-[var(--pf-card-border)] pt-3">
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClass(
                    row.status,
                  )}`}
                >
                  {row.status}
                </span>
              </div>
            </article>
          ))
        ) : (
          <div className="rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-4 py-6 text-sm text-[var(--pf-text-muted)]">
            No gameweeks imported yet.
          </div>
        )}
      </div>

      <div className="mt-5 hidden overflow-hidden rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--pf-navy-deep)] text-xs uppercase text-[var(--pf-text-muted)]">
            <tr>
              <th className="px-4 py-3">Gameweek</th>
              <th className="px-4 py-3">Matches</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--pf-card-border)]">
            {rows.length ? (
              rows.map((row) => (
                <tr
                  className="transition hover:bg-[var(--pf-brand-blue-soft)]"
                  key={row.gameweek_id}
                >
                  <td className="px-4 py-3 font-medium text-[var(--pf-text)]">
                    {row.gameweek_name}
                    {row.active_chip ? (
                      <p className="mt-1 text-xs font-semibold text-[var(--pf-fantasy-yellow)]">
                        {chipLabels[row.active_chip] ?? row.active_chip}
                      </p>
                    ) : null}
                    {formatTransferPenalty(row) ? (
                      <p className="mt-1 text-xs font-semibold text-amber-100">
                        {formatTransferPenalty(row)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-[var(--pf-text-muted)]">
                    {formatMatchDates(row)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClass(
                        row.status,
                      )}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[var(--pf-text)]">
                    {formatPoints(row.points)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  className="px-4 py-6 text-[var(--pf-text-muted)]"
                  colSpan={4}
                >
                  No gameweeks imported yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

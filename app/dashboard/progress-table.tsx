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

  return "border-sky-200/20 bg-sky-200/10 text-sky-100";
}

export function ProgressTable({ rows }: { rows: ProgressRow[] }) {
  return (
    <>
      <div className="mt-5 space-y-3 md:hidden">
        {rows.length ? (
          rows.map((row) => (
            <article
              className="rounded-lg border border-white/10 bg-sky-950/50 p-4"
              key={row.gameweek_id}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate font-bold">{row.gameweek_name}</h2>
                  <p className="mt-1 text-xs leading-5 text-sky-100/55">
                    {formatMatchDates(row)}
                  </p>
                  {row.active_chip ? (
                    <p className="mt-2 text-xs font-semibold text-emerald-200">
                      {chipLabels[row.active_chip] ?? row.active_chip}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xl font-black text-sky-100">
                    {formatPoints(row.points)}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-sky-100/40">
                    Points
                  </p>
                </div>
              </div>
              <div className="mt-4 border-t border-white/10 pt-3">
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
          <div className="rounded-lg border border-white/10 bg-sky-950/50 px-4 py-6 text-sm text-sky-100/60">
            No gameweeks imported yet.
          </div>
        )}
      </div>

      <div className="mt-5 hidden overflow-hidden rounded-md border border-white/15 bg-sky-950/50 md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/10 text-xs uppercase text-sky-100/60">
            <tr>
              <th className="px-4 py-3">Gameweek</th>
              <th className="px-4 py-3">Matches</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.length ? (
              rows.map((row) => (
                <tr className="transition hover:bg-white/5" key={row.gameweek_id}>
                  <td className="px-4 py-3 font-medium">
                    {row.gameweek_name}
                    {row.active_chip ? (
                      <p className="mt-1 text-xs font-semibold text-emerald-200">
                        {chipLabels[row.active_chip] ?? row.active_chip}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sky-100/70">
                    {formatMatchDates(row)}
                  </td>
                  <td className="px-4 py-3 text-sky-100/70">{row.status}</td>
                  <td className="px-4 py-3 text-right font-semibold text-sky-100">
                    {formatPoints(row.points)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-sky-100/60" colSpan={4}>
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

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

export function ProgressTable({ rows }: { rows: ProgressRow[] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-md border border-white/15 bg-sky-950/50">
      <table className="w-full min-w-[680px] text-left text-sm">
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
            rows.map((row) => {
              return (
                <tr className="transition hover:bg-white/5" key={row.gameweek_id}>
                  <td className="px-4 py-3 font-medium">
                    {row.gameweek_name}
                  </td>
                  <td className="px-4 py-3 text-sky-100/70">
                    {formatDate(row.first_match_starts_at)}
                    {row.first_match_starts_at !== row.last_match_ends_at
                      ? ` - ${formatDate(row.last_match_ends_at)}`
                      : ""}
                  </td>
                  <td className="px-4 py-3 text-sky-100/70">{row.status}</td>
                  <td className="px-4 py-3 text-right font-semibold text-sky-100">
                    {formatPoints(row.points)}
                  </td>
                </tr>
              );
            })
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
  );
}

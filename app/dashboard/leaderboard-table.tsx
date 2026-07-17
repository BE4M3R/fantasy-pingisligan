export type LeaderboardRow = {
  user_id: string;
  team_name: string;
  total_points: number | string;
};

function formatPoints(value: number | string) {
  return new Intl.NumberFormat("sv-SE").format(Number(value));
}

export function LeaderboardTable({
  currentUserId,
  rows,
}: {
  currentUserId: string;
  rows: LeaderboardRow[];
}) {
  return (
    <>
      <div className="mt-5 space-y-2 md:hidden">
        {rows.length ? (
          rows.map((row, index) => {
            const isCurrentUser = row.user_id === currentUserId;

            return (
              <div
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-sky-950/50 p-4"
                key={row.user_id}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-black text-sky-100">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{row.team_name}</p>
                    {isCurrentUser ? (
                      <span className="shrink-0 rounded-sm bg-emerald-400 px-1.5 py-0.5 text-[10px] font-black uppercase text-zinc-950">
                        You
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-sky-100/45">Overall points</p>
                </div>
                <p className="shrink-0 text-lg font-black text-sky-100">
                  {formatPoints(row.total_points)}
                </p>
              </div>
            );
          })
        ) : (
          <div className="rounded-lg border border-white/10 bg-sky-950/50 px-4 py-6 text-sm text-sky-100/60">
            No fantasy teams yet.
          </div>
        )}
      </div>

      <div className="mt-5 hidden overflow-hidden rounded-md border border-white/15 bg-sky-950/50 md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/10 text-xs uppercase text-sky-100/60">
            <tr>
              <th className="w-20 px-4 py-3">Rank</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3 text-right">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.length ? (
              rows.map((row, index) => {
                const isCurrentUser = row.user_id === currentUserId;

                return (
                  <tr
                    className="transition hover:bg-white/5"
                    key={row.user_id}
                  >
                    <td className="px-4 py-3 font-bold text-sky-100">
                      {index + 1}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span>{row.team_name}</span>
                        {isCurrentUser ? (
                          <span className="rounded-sm bg-emerald-400 px-1.5 py-0.5 text-[10px] font-black uppercase text-zinc-950">
                            You
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-sky-100">
                      {formatPoints(row.total_points)}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-6 text-sky-100/60" colSpan={3}>
                  No fantasy teams yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export type LeaderboardRow = {
  user_id: string;
  team_name: string;
  total_points: number | string;
};

function formatPoints(value: number | string) {
  return new Intl.NumberFormat("sv-SE").format(Number(value));
}

function getRankClass(rank: number) {
  return rank <= 3
    ? "border-[var(--pf-fantasy-yellow)]/40 bg-[var(--pf-fantasy-yellow)]/10 text-[var(--pf-fantasy-yellow)]"
    : "border-[var(--pf-card-border)] bg-[var(--pf-navy)] text-[var(--pf-text-muted)]";
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
                className={`flex items-center gap-3 rounded-lg border p-4 ${
                  isCurrentUser
                    ? "border-[var(--pf-brand-blue)] bg-[var(--pf-brand-blue-soft)]"
                    : "border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)]"
                }`}
                key={row.user_id}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-black ${getRankClass(
                    index + 1,
                  )}`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-[var(--pf-text)]">
                      {row.team_name}
                    </p>
                    {isCurrentUser ? (
                      <span className="shrink-0 rounded-sm bg-[var(--pf-brand-blue)] px-1.5 py-0.5 text-[10px] font-black uppercase text-[var(--pf-navy-deep)]">
                        You
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--pf-text-muted)]">
                    Overall points
                  </p>
                </div>
                <p className="shrink-0 text-lg font-black text-[var(--pf-text)]">
                  {formatPoints(row.total_points)}
                </p>
              </div>
            );
          })
        ) : (
          <div className="rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-4 py-6 text-sm text-[var(--pf-text-muted)]">
            No fantasy teams yet.
          </div>
        )}
      </div>

      <div className="mt-5 hidden overflow-hidden rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--pf-navy-deep)] text-xs uppercase text-[var(--pf-text-muted)]">
            <tr>
              <th className="w-20 px-4 py-3">Rank</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3 text-right">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--pf-card-border)]">
            {rows.length ? (
              rows.map((row, index) => {
                const isCurrentUser = row.user_id === currentUserId;

                return (
                  <tr
                    className={`transition hover:bg-[var(--pf-brand-blue-soft)] ${
                      isCurrentUser ? "bg-[var(--pf-brand-blue-soft)]" : ""
                    }`}
                    key={row.user_id}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border font-black ${getRankClass(
                          index + 1,
                        )}`}
                      >
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--pf-text)]">
                      <div className="flex items-center gap-2">
                        <span>{row.team_name}</span>
                        {isCurrentUser ? (
                          <span className="rounded-sm bg-[var(--pf-brand-blue)] px-1.5 py-0.5 text-[10px] font-black uppercase text-[var(--pf-navy-deep)]">
                            You
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--pf-text)]">
                      {formatPoints(row.total_points)}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  className="px-4 py-6 text-[var(--pf-text-muted)]"
                  colSpan={3}
                >
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

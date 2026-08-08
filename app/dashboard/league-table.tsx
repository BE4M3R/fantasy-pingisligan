"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export type LeagueTableRow = {
  user_id: string;
  team_name: string;
  total_points: number | string;
};

type GameweekScore = {
  gameweek_id: string;
  gameweek_name: string;
  points: number | string;
  round_order: number | null;
};

function formatPoints(value: number | string | null | undefined) {
  return new Intl.NumberFormat("sv-SE").format(Number(value ?? 0));
}

function getRankClass(rank: number) {
  switch (rank) {
    case 1:
      return "border-[var(--pf-rank-gold)]/70 bg-[var(--pf-rank-gold)]/20 text-[var(--pf-rank-gold)]";
    case 2:
      return "border-[var(--pf-rank-silver)]/50 bg-[var(--pf-rank-silver)]/10 text-[var(--pf-rank-silver)]";
    case 3:
      return "border-[var(--pf-rank-bronze)]/50 bg-[var(--pf-rank-bronze)]/10 text-[var(--pf-rank-bronze)]";
    default:
      return "border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] text-[var(--pf-text-muted)]";
  }
}

export function LeagueTable({
  currentUserId,
  rows,
}: {
  currentUserId: string;
  rows: LeagueTableRow[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedTeam, setSelectedTeam] = useState<LeagueTableRow | null>(null);
  const [gameweekScores, setGameweekScores] = useState<GameweekScore[]>([]);
  const [gameweekIndex, setGameweekIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const selectedGameweek = gameweekScores[gameweekIndex];

  async function openGameweekScores(row: LeagueTableRow) {
    setSelectedTeam(row);
    setGameweekScores([]);
    setGameweekIndex(0);
    setLoadError(false);
    setIsLoading(true);
    dialogRef.current?.showModal();

    const supabase = createClient();
    const { data, error } = await supabase.rpc(
      "get_leaderboard_team_gameweek_points",
      { p_user_id: row.user_id },
    );

    if (error) {
      setLoadError(true);
      setIsLoading(false);
      return;
    }

    const scores = (data ?? []) as GameweekScore[];
    setGameweekScores(scores);
    setGameweekIndex(Math.max(scores.length - 1, 0));
    setIsLoading(false);
  }

  return (
    <>
      <div className="mt-5 space-y-2 md:hidden">
        {rows.length ? (
          rows.map((row, index) => {
            const isCurrentUser = row.user_id === currentUserId;

            return (
              <button
                className="flex w-full items-center gap-3 rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-4 text-left transition hover:border-[var(--pf-brand-blue-border)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                key={row.user_id}
                onClick={() => openGameweekScores(row)}
                type="button"
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
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--pf-text-muted)]">
                    Total
                  </p>
                  <p className="mt-0.5 text-lg font-black text-[var(--pf-text)]">
                    {formatPoints(row.total_points)}
                  </p>
                </div>
              </button>
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
              <th className="px-4 py-3 text-right">Total points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--pf-card-border)]">
            {rows.length ? (
              rows.map((row, index) => {
                const isCurrentUser = row.user_id === currentUserId;

                return (
                  <tr
                    className="transition hover:bg-[var(--pf-brand-blue-soft)]"
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
                      <button
                        className="flex items-center gap-2 text-left hover:text-[var(--pf-brand-blue-hover)] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                        onClick={() => openGameweekScores(row)}
                        type="button"
                      >
                        <span>{row.team_name}</span>
                        {isCurrentUser ? (
                          <span className="rounded-sm bg-[var(--pf-brand-blue)] px-1.5 py-0.5 text-[10px] font-black uppercase text-[var(--pf-navy-deep)]">
                            You
                          </span>
                        ) : null}
                      </button>
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

      <dialog
        aria-labelledby="gameweek-score-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-0 text-[var(--pf-text)] shadow-2xl backdrop:bg-[var(--pf-navy-deep)]/80"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        ref={dialogRef}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--pf-brand-blue)]">
                Gameweek points
              </p>
              <h2
                className="mt-1 truncate text-xl font-black"
                id="gameweek-score-title"
              >
                {selectedTeam?.team_name}
              </h2>
            </div>
            <button
              aria-label="Close gameweek points"
              className="-mr-2 -mt-2 rounded-md p-2 text-2xl leading-none text-[var(--pf-text-muted)] transition hover:bg-[var(--pf-navy-elevated)] hover:text-[var(--pf-text)]"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              ×
            </button>
          </div>

          {isLoading ? (
            <p className="mt-6 rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-6 text-center text-sm text-[var(--pf-text-muted)]">
              Loading gameweeks…
            </p>
          ) : loadError ? (
            <p className="mt-6 rounded-lg border border-[var(--pf-coral)]/45 bg-[var(--pf-coral-soft)] p-4 text-sm text-[var(--pf-coral-text)]">
              Gameweek scores could not be loaded. Run the gameweek details
              migration in Supabase.
            </p>
          ) : selectedGameweek ? (
            <div className="mt-6">
              <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-3">
                <button
                  aria-label="Previous gameweek"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-xl font-bold transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] disabled:cursor-not-allowed disabled:opacity-30"
                  disabled={gameweekIndex === 0}
                  onClick={() => setGameweekIndex((index) => index - 1)}
                  type="button"
                >
                  ←
                </button>
                <div className="min-w-0 text-center">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--pf-text-muted)]">
                    {selectedGameweek.round_order !== null
                      ? `Gameweek ${selectedGameweek.round_order}`
                      : "Gameweek"}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-[var(--pf-text)]">
                    {selectedGameweek.gameweek_name}
                  </p>
                </div>
                <button
                  aria-label="Next gameweek"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-xl font-bold transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] disabled:cursor-not-allowed disabled:opacity-30"
                  disabled={gameweekIndex === gameweekScores.length - 1}
                  onClick={() => setGameweekIndex((index) => index + 1)}
                  type="button"
                >
                  →
                </button>
              </div>

              <div className="mt-5 rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-6 text-center">
                <p className="text-4xl font-black text-[var(--pf-text)]">
                  {formatPoints(selectedGameweek.points)}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[var(--pf-text-muted)]">
                  Points
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-6 rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-6 text-center text-sm text-[var(--pf-text-muted)]">
              No scored gameweeks yet.
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}

"use client";

import { Fragment, type MouseEvent, useEffect, useRef, useState } from "react";
import { GameweekResultNavigation } from "@/app/dashboard/gameweek-result-navigation";
import { LeagueSquadPreview, type LeagueSnapshotPlayer } from "@/app/dashboard/league-squad-preview";
import { animatePopupOpen } from "@/app/dashboard/popup-animation";
import { SquadLineupView } from "@/app/dashboard/squad-lineup-view";
import { createClient } from "@/lib/supabase/browser";

export type LeagueTableRow = {
  rank?: number;
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

async function loadGameweekScores(userId: string) {
  const { data, error } = await createClient().rpc(
    "get_leaderboard_team_gameweek_points", { p_user_id: userId },
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as GameweekScore[];
}

async function loadSnapshotLineup(userId: string, gameweekId: string) {
  const { data, error } = await createClient().rpc(
    "get_leaderboard_team_gameweek_lineup",
    { p_user_id: userId, p_gameweek_id: gameweekId },
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as LeagueSnapshotPlayer[];
}

const CHIP_LABELS = {
  wildcard: "Wildcard",
  triple_captain: "Triple Captain",
  bench_boost: "Bench Boost",
} as const;

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

function LeagueTeamLoading() {
  const placeholderCard = <div className="h-24 w-[96%] max-w-[12.25rem] rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy)] sm:h-32" />;

  return (
    <div className="relative mt-6">
      <div aria-hidden="true" className="opacity-60">
        <GameweekResultNavigation
          ariaLabel="Gameweek navigation"
          label=""
          loading
          placeholder
          pointsText=""
          transferPenalty={null}
        />
        <div className="mx-auto mt-3 h-4 w-32 rounded bg-[var(--pf-navy-elevated)]" />
        <SquadLineupView
          className="mt-4"
          idPrefix="league-loading"
          title="Active players"
          compactTitle
          starterCount={4}
          benchCount={2}
          renderStarter={() => placeholderCard}
          renderBench={() => placeholderCard}
        />
      </div>
      <p className="absolute inset-0 z-30 flex items-center justify-center text-center text-sm font-semibold text-[var(--pf-text)]" role="status">
        <span className="rounded-md bg-[var(--pf-navy)] px-4 py-2 shadow-lg">Loading team…</span>
      </p>
    </div>
  );
}

export function LeagueTable({
  currentUserId,
  initialRowCount,
  rows,
  searchable = false,
  totalRowCount,
}: {
  currentUserId: string;
  initialRowCount?: number;
  rows: LeagueTableRow[];
  searchable?: boolean;
  totalRowCount?: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const searchRequestRef = useRef(0);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [loadedRows, setLoadedRows] = useState<LeagueTableRow[]>([]);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState("");
  const [remainingTotal, setRemainingTotal] = useState(totalRowCount ?? rows.length);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [searchRows, setSearchRows] = useState<LeagueTableRow[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [tableMinHeight, setTableMinHeight] = useState<number>();
  const scoresRequestRef = useRef(0);
  const lineupRequestRef = useRef(0);
  const lineupCacheRef = useRef<Record<string, LeagueSnapshotPlayer[]>>({});
  const lineupRequestsRef = useRef(new Map<string, Promise<LeagueSnapshotPlayer[]>>());
  const paginated = totalRowCount !== undefined;
  const displayedRows = paginated && showAll ? loadedRows : rows;
  const [selectedTeam, setSelectedTeam] = useState<LeagueTableRow | null>(null);
  const [gameweekScores, setGameweekScores] = useState<GameweekScore[]>([]);
  const [gameweekIndex, setGameweekIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [lineupByGameweek, setLineupByGameweek] = useState<Record<string, LeagueSnapshotPlayer[]>>({});
  const [isLoadingLineup, setIsLoadingLineup] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [navigationErrorIndex, setNavigationErrorIndex] = useState<number | null>(null);
  const [lineupError, setLineupError] = useState(false);
  const selectedGameweek = gameweekScores[gameweekIndex];
  const selectedGameweekLabel = selectedGameweek
    ? selectedGameweek.round_order !== null
      ? `Gameweek ${selectedGameweek.round_order}`
      : selectedGameweek.gameweek_name.replace(/^round\s*/i, "Gameweek ")
    : "Gameweek";
  const selectedLineup = selectedGameweek ? lineupByGameweek[selectedGameweek.gameweek_id] : undefined;
  const visibleSourceRows = activeSearch ? searchRows : displayedRows;
  const rankedRows = visibleSourceRows.map((row, index) => ({ rank: row.rank ?? index + 1, row }));
  const currentUserRow = rankedRows.find(
    ({ row }) => row.user_id === currentUserId,
  );
  const hasCollapsedRows =
    initialRowCount !== undefined && (totalRowCount ?? rows.length) > initialRowCount;
  const isCompact = !activeSearch && hasCollapsedRows && !showAll;
  const showCurrentUserSeparately = Boolean(
    isCompact && currentUserRow && currentUserRow.rank > initialRowCount,
  );
  const visibleRows = isCompact
    ? [
        ...rankedRows.slice(0, initialRowCount),
        ...(showCurrentUserSeparately && currentUserRow ? [currentUserRow] : []),
      ]
    : rankedRows;

  useEffect(() => () => {
    ++searchRequestRef.current;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchAbortRef.current?.abort();
  }, []);

  function updateSearch(value: string) {
    // Reserve the current results height before clearing rows so the browser
    // never clamps the scroll position when loading or showing fewer matches.
    const tableHeight = tableRef.current?.getBoundingClientRect().height ?? 0;
    setTableMinHeight((previous) => Math.max(previous ?? 0, Math.ceil(tableHeight)));
    setSearchInput(value);
    const query = value.trim();
    const requestId = ++searchRequestRef.current;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchAbortRef.current?.abort();
    setRowsError("");
    setActiveSearch(query);
    setSearchRows([]);
    setSearchTotal(0);
    setIsLoadingRows(Boolean(query));
    if (!query) return;

    const controller = new AbortController();
    searchAbortRef.current = controller;
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: query, offset: "0" });
        const response = await fetch(`/api/leaderboard?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search could not be loaded.");
        const payload = await response.json() as { rows: LeagueTableRow[]; total: number };
        if (requestId !== searchRequestRef.current) return;
        setSearchRows(payload.rows);
        setSearchTotal(payload.total);
      } catch {
        if (requestId === searchRequestRef.current) setRowsError("Team search could not be loaded. Please try again.");
      } finally {
        if (requestId === searchRequestRef.current) setIsLoadingRows(false);
      }
    }, 200);
  }

  async function loadMoreRows() {
    if (isLoadingRows) return;
    const requestId = searchRequestRef.current;
    setIsLoadingRows(true);
    setRowsError("");
    try {
      const offset = activeSearch ? searchRows.length : showAll ? loadedRows.length : 0;
      const params = new URLSearchParams({ offset: String(offset) });
      if (activeSearch) params.set("search", activeSearch);
      const response = await fetch(`/api/leaderboard?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Standings could not be loaded.");
      const payload = await response.json() as { rows: LeagueTableRow[]; total: number };
      if (requestId !== searchRequestRef.current) return;
      if (activeSearch) {
        setSearchTotal(payload.total);
        setSearchRows((previous) => [...previous, ...payload.rows]);
      } else {
        setRemainingTotal(payload.total);
        setLoadedRows((previous) => offset ? [...previous, ...payload.rows] : payload.rows);
        setShowAll(true);
      }
    } catch {
      if (requestId === searchRequestRef.current) setRowsError("Standings could not be loaded. Please try again.");
    } finally {
      if (requestId === searchRequestRef.current) setIsLoadingRows(false);
    }
  }

  async function openGameweekScores(row: LeagueTableRow, event: MouseEvent<HTMLButtonElement>) {
    const requestId = ++scoresRequestRef.current;
    ++lineupRequestRef.current;
    setSelectedTeam(row);
    setGameweekScores([]);
    setGameweekIndex(0);
    lineupCacheRef.current = {};
    lineupRequestsRef.current = new Map();
    setLineupByGameweek({});
    setLoadError(false);
    setLineupError(false);
    setIsLoadingLineup(false);
    setIsNavigating(false);
    setNavigationErrorIndex(null);
    setIsLoading(true);
    const dialog = dialogRef.current;
    dialog?.showModal();
    animatePopupOpen(dialog, event.currentTarget, event.detail
      ? { x: event.clientX, y: event.clientY }
      : null);

    try {
      const scores = await loadGameweekScores(row.user_id);
      if (requestId !== scoresRequestRef.current) return;
      setGameweekScores(scores);
      const index = Math.max(scores.length - 1, 0);
      setGameweekIndex(index);
      if (scores.length) {
        const lineupRequestId = ++lineupRequestRef.current;
        try {
          const players = await getCachedLineup(row.user_id, scores[index].gameweek_id);
          if (requestId !== scoresRequestRef.current || lineupRequestId !== lineupRequestRef.current) return;
          setLineupByGameweek({ [scores[index].gameweek_id]: players });
          prefetchAdjacentLineups(row.user_id, scores, index);
        } catch {
          if (requestId === scoresRequestRef.current && lineupRequestId === lineupRequestRef.current) {
            setLineupError(true);
          }
        }
      }
    } catch {
      if (requestId === scoresRequestRef.current) setLoadError(true);
    } finally {
      if (requestId === scoresRequestRef.current) setIsLoading(false);
    }
  }

  function getCachedLineup(userId: string, gameweekId: string) {
    const cached = lineupCacheRef.current[gameweekId];
    if (cached) return Promise.resolve(cached);
    const pending = lineupRequestsRef.current;
    const existing = pending.get(gameweekId);
    if (existing) return existing;

    const cache = lineupCacheRef.current;
    const request = loadSnapshotLineup(userId, gameweekId)
      .then((players) => {
        cache[gameweekId] = players;
        return players;
      })
      .finally(() => pending.delete(gameweekId));
    pending.set(gameweekId, request);
    return request;
  }

  function prefetchAdjacentLineups(userId: string, scores: GameweekScore[], index: number) {
    for (const adjacentIndex of [index - 1, index + 1]) {
      const adjacent = scores[adjacentIndex];
      if (adjacent) void getCachedLineup(userId, adjacent.gameweek_id).catch(() => {
        // Navigation can retry if a background request fails.
      });
    }
  }

  async function selectLineup(
    userId: string,
    scores: GameweekScore[],
    index: number,
    keepCurrent = false,
  ) {
    const gameweekId = scores[index].gameweek_id;
    const requestId = ++lineupRequestRef.current;
    const navigating = keepCurrent && Boolean(selectedLineup?.length);
    setLineupError(false);
    setNavigationErrorIndex(null);
    setIsNavigating(navigating);
    if (!navigating) setIsLoadingLineup(true);
    try {
      const players = await getCachedLineup(userId, gameweekId);
      if (requestId !== lineupRequestRef.current) return;
      setLineupByGameweek((previous) => ({ ...previous, [gameweekId]: players }));
      setGameweekIndex(index);
      prefetchAdjacentLineups(userId, scores, index);
    } catch {
      if (requestId === lineupRequestRef.current) {
        if (navigating) setNavigationErrorIndex(index);
        else setLineupError(true);
      }
    } finally {
      if (requestId === lineupRequestRef.current) {
        setIsLoadingLineup(false);
        setIsNavigating(false);
      }
    }
  }

  function navigateGameweek(index: number) {
    if (!gameweekScores[index] || !selectedTeam || isNavigating) return;
    void selectLineup(selectedTeam.user_id, gameweekScores, index, true);
  }

  return (
    <div
      aria-busy={isLoadingRows}
      className="flow-root"
      ref={tableRef}
      style={{ minHeight: tableMinHeight, overflowAnchor: searchable ? "none" : undefined }}
    >
      {searchable ? (
        <div className="mt-5" role="search">
          <label className="mb-1.5 block text-xs font-bold text-[var(--pf-text-muted)]" htmlFor="global-team-search">
            Search team name
          </label>
          <div className="flex w-full items-center rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] focus-within:border-[var(--pf-brand-blue)] focus-within:ring-2 focus-within:ring-[var(--pf-brand-blue)]/40">
            <input
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-[var(--pf-text)] placeholder:text-[var(--pf-text-muted)] focus:outline-none"
              id="global-team-search"
              inputMode="search"
              maxLength={80}
              onChange={(event) => updateSearch(event.target.value)}
              placeholder="Find a team…"
              role="searchbox"
              type="text"
              value={searchInput}
            />
            {searchInput ? (
              <button
                aria-label="Clear team search"
                className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xl leading-none text-[var(--pf-text-muted)] transition hover:text-[var(--pf-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                onClick={() => updateSearch("")}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-5 space-y-2 md:hidden">
        {visibleRows.length ? (
          visibleRows.map(({ rank, row }) => {
            const isCurrentUser = row.user_id === currentUserId;

            return (
              <Fragment key={row.user_id}>
                {showCurrentUserSeparately && isCurrentUser ? (
                  <div className="flex items-center gap-3 py-1" role="separator">
                    <span className="h-px flex-1 bg-[var(--pf-card-border)]" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--pf-text-muted)]">
                      Your position
                    </span>
                    <span className="h-px flex-1 bg-[var(--pf-card-border)]" />
                  </div>
                ) : null}
                <button
                  className="flex w-full items-center gap-3 rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-2.5 text-left transition hover:border-[var(--pf-brand-blue-border)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                  onClick={(event) => void openGameweekScores(row, event)}
                  type="button"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-black ${getRankClass(
                      rank,
                    )}`}
                  >
                    {rank}
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
                    <p className="mt-0.5 text-base font-black text-[var(--pf-text)]">
                      {formatPoints(row.total_points)}
                    </p>
                  </div>
                </button>
              </Fragment>
            );
          })
        ) : (
          <div className="rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-4 py-6 text-sm text-[var(--pf-text-muted)]">
            {isLoadingRows ? "Searching teams…" : rowsError ? "Search unavailable." : activeSearch ? "No teams found." : "No fantasy teams yet."}
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
            {visibleRows.length ? (
              visibleRows.map(({ rank, row }) => {
                const isCurrentUser = row.user_id === currentUserId;

                return (
                  <Fragment key={row.user_id}>
                    {showCurrentUserSeparately && isCurrentUser ? (
                      <tr>
                        <td className="px-4 py-2" colSpan={3}>
                          <div className="flex items-center gap-3">
                            <span className="h-px flex-1 bg-[var(--pf-card-border)]" />
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--pf-text-muted)]">
                              Your position
                            </span>
                            <span className="h-px flex-1 bg-[var(--pf-card-border)]" />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    <tr className="transition hover:bg-[var(--pf-brand-blue-soft)]">
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border font-black ${getRankClass(
                            rank,
                          )}`}
                        >
                          {rank}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-[var(--pf-text)]">
                        <button
                          className="flex items-center gap-2 text-left hover:text-[var(--pf-brand-blue-hover)] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                          onClick={(event) => void openGameweekScores(row, event)}
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
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td
                  className="px-4 py-6 text-[var(--pf-text-muted)]"
                  colSpan={3}
                >
                  {isLoadingRows ? "Searching teams…" : rowsError ? "Search unavailable." : activeSearch ? "No teams found." : "No fantasy teams yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(activeSearch ? searchRows.length < searchTotal : hasCollapsedRows && (!paginated || !showAll || loadedRows.length < remainingTotal)) ? (
        <button
          aria-expanded={activeSearch ? true : showAll}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-4 py-2.5 text-sm font-bold text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
          disabled={isLoadingRows}
          onClick={() => paginated ? void loadMoreRows() : setShowAll((isShowingAll) => !isShowingAll)}
          type="button"
        >
          {paginated ? (isLoadingRows ? "Loading…" : "Show more teams") : showAll ? `Show top ${initialRowCount}` : `Show all ${rows.length} teams`}
          <span aria-hidden="true">{activeSearch ? "↓" : showAll ? "↑" : "↓"}</span>
        </button>
      ) : null}

      {rowsError ? <p role="alert">{rowsError}</p> : null}

      <dialog
        aria-labelledby="gameweek-score-title"
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-page-blue)] p-0 text-[var(--pf-text)] shadow-2xl backdrop:bg-[var(--pf-navy-deep)]/80"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        ref={dialogRef}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--pf-text)]">
                Gameweek team
              </p>
              <h2
                className="mt-1 truncate text-xl font-black"
                id="gameweek-score-title"
              >
                {selectedTeam?.team_name}
              </h2>
            </div>
            <button
              aria-label="Close gameweek team"
              className="-mr-2 -mt-2 rounded-md p-2 text-2xl leading-none text-[var(--pf-text-muted)] transition hover:bg-[var(--pf-navy-elevated)] hover:text-[var(--pf-text)]"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              ×
            </button>
          </div>

          {isLoading ? (
            <LeagueTeamLoading />
          ) : loadError ? (
            <p className="mt-6 rounded-lg border border-[var(--pf-coral)]/45 bg-[var(--pf-coral-soft)] p-4 text-sm text-[var(--pf-coral-text)]">
              Gameweek details could not be loaded. Please try again.
            </p>
          ) : selectedGameweek ? (
            <div className="mt-6">
              <GameweekResultNavigation
                ariaLabel="Gameweek navigation"
                label={selectedGameweekLabel}
                loading={isNavigating || isLoadingLineup}
                next={{
                  label: "Next gameweek",
                  onClick: gameweekIndex < gameweekScores.length - 1
                    ? () => navigateGameweek(gameweekIndex + 1)
                    : undefined,
                }}
                pointsText={formatPoints(selectedGameweek.points)}
                previous={{
                  label: "Previous gameweek",
                  onClick: gameweekIndex > 0
                    ? () => navigateGameweek(gameweekIndex - 1)
                    : undefined,
                }}
                transferPenalty={selectedLineup?.[0]?.transfer_penalty_points ?? null}
              />

              {navigationErrorIndex !== null ? (
                <div className="mt-3 text-center text-sm text-[var(--pf-coral-text)]" role="alert">
                  <p>Gameweek could not be loaded.</p>
                  <button
                    className="mt-1 rounded-md border border-[var(--pf-brand-blue-border)] px-3 py-1 font-bold text-[var(--pf-text)] hover:bg-[var(--pf-brand-blue-soft)]"
                    onClick={() => navigateGameweek(navigationErrorIndex)}
                    type="button"
                  >
                    Try again
                  </button>
                </div>
              ) : null}

              {selectedLineup?.[0]?.active_chip ? (
                <p className="mt-3 text-center text-xs font-bold text-[var(--pf-fantasy-yellow)]">
                  {CHIP_LABELS[selectedLineup[0].active_chip]} activated
                </p>
              ) : selectedLineup?.length ? (
                <p className="mt-3 text-center text-xs text-[var(--pf-text-muted)]">No chip activated</p>
              ) : null}

              {isLoadingLineup ? (
                <p className="mt-5 text-center text-sm text-[var(--pf-text-muted)]">Loading team…</p>
              ) : lineupError ? (
                <div className="mt-5 text-center text-sm text-[var(--pf-coral-text)]" role="alert">
                  <p>Team snapshot could not be loaded.</p>
                  <button
                    className="mt-2 rounded-md border border-[var(--pf-brand-blue-border)] px-3 py-1.5 font-bold text-[var(--pf-text)] hover:bg-[var(--pf-brand-blue-soft)]"
                    onClick={() => selectedTeam && void selectLineup(selectedTeam.user_id, gameweekScores, gameweekIndex)}
                    type="button"
                  >
                    Try again
                  </button>
                </div>
              ) : selectedTeam && selectedLineup?.length ? (
                <LeagueSquadPreview
                  key={`${selectedTeam.user_id}:${selectedGameweek.gameweek_id}`}
                  players={selectedLineup}
                  userId={selectedTeam.user_id}
                  gameweekId={selectedGameweek.gameweek_id}
                  gameweekLabel={selectedGameweekLabel}
                />
              ) : (
                <p className="mt-5 text-center text-sm text-[var(--pf-text-muted)]">No team snapshot for this gameweek.</p>
              )}
            </div>
          ) : (
            <p className="mt-6 rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-6 text-center text-sm text-[var(--pf-text-muted)]">
              No scored gameweeks yet.
            </p>
          )}
        </div>
      </dialog>
    </div>
  );
}

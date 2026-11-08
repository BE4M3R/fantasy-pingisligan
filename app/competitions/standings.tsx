"use client";

import { useEffect, useRef, useState } from "react";
import type { CompetitionStandings as Standings } from "@/lib/competitions";

export function CompetitionStandings({ gameweekId, initial }: { gameweekId: string; initial: Standings | null }) {
  const [standings, setStandings] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initial ? "" : "Standings are temporarily unavailable.");
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState<Standings | null>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const query = search.trim();
  const displayed = query ? searchResult : standings;

  useEffect(() => () => {
    ++requestRef.current;
    abortRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  async function loadRows(offset: number, term: string) {
    const requestId = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ offset: String(offset) });
      if (term) params.set("search", term);
      const response = await fetch(`/api/competitions/gameweek/${gameweekId}/standings?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Standings unavailable");
      const next = await response.json() as Standings;
      if (requestId !== requestRef.current) return;
      const update = (previous: Standings | null) => ({ ...next, rows: offset && next.visible ? [...(previous?.rows ?? []), ...next.rows] : next.rows });
      if (term) setSearchResult(update);
      else setStandings(update);
    } catch {
      if (requestId === requestRef.current) setError("Standings could not be loaded. Please try again.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  function updateSearch(value: string) {
    ++requestRef.current;
    abortRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setSearch(value);
    setSearchResult(null);
    setError("");
    setLoading(Boolean(value.trim()));
    if (value.trim()) timeoutRef.current = setTimeout(() => void loadRows(0, value.trim()), 200);
  }

  return <div className="mt-4" aria-busy={loading}>
    <div className="mb-4" role="search">
      <label htmlFor="competition-team-search" className="mb-1.5 block text-xs font-bold text-[var(--pf-text-muted)]">Search team name</label>
      <div className="flex items-center rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] focus-within:border-[var(--pf-brand-blue)] focus-within:ring-2 focus-within:ring-[var(--pf-brand-blue)]/40">
        <input id="competition-team-search" type="search" maxLength={80} value={search} disabled={initial?.visible === false}
          onChange={(event) => updateSearch(event.target.value)} placeholder="Find a team…"
          className="min-h-11 min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base text-[var(--pf-text)] placeholder:text-[var(--pf-text-muted)] focus:outline-none disabled:opacity-50" />
        {search ? <button type="button" aria-label="Clear team search" onClick={() => updateSearch("")}
          className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xl text-[var(--pf-text-muted)] hover:text-[var(--pf-text)] focus-visible:outline-2 focus-visible:outline-[var(--pf-brand-blue)]">×</button> : null}
      </div>
    </div>
    {displayed?.visible ? <>
      {displayed.missing_scores > 0 || displayed.outstanding_fixtures > 0 || displayed.fixture_count === 0 ?
        <p className="mb-3 text-sm text-[var(--pf-text-muted)]">Results are still coming in. Standings may change.</p> : null}
      {displayed.rows.length ? <table className="w-full table-fixed text-left text-sm">
        <caption className="sr-only">Provisional Gameweek Fantasy standings</caption>
        <thead className="border-b border-[var(--pf-card-border)] text-xs uppercase tracking-wide text-[var(--pf-text-muted)]">
          <tr><th scope="col" className="w-12 py-3 sm:w-16">Rank</th><th scope="col" className="py-3">Fantasy team</th><th scope="col" className="w-16 py-3 text-right">Points</th></tr>
        </thead>
        <tbody>{displayed.rows.map((row, index) => <tr key={index} className="border-b border-[var(--pf-card-border)] last:border-0">
          <td className={`py-3 font-black tabular-nums ${row.rank === 1 ? "text-[var(--pf-rank-gold)]" : row.rank === 2 ? "text-[var(--pf-rank-silver)]" : row.rank === 3 ? "text-[var(--pf-rank-bronze)]" : "text-[var(--pf-text-muted)]"}`}>{row.rank}</td>
          <td className="break-words py-3 pr-3 font-semibold">{row.team_name}</td>
          <td className="py-3 text-right font-bold tabular-nums">{row.points}</td>
        </tr>)}</tbody>
      </table> : <p className="text-sm leading-6 text-[var(--pf-text-muted)]">{query ? "No teams found." : "No scored squads yet. Standings will appear as Gameweek results are refreshed."}</p>}
    </> : displayed ? <p className="text-sm leading-6 text-[var(--pf-text-muted)]">This Gameweek has not started. Standings will appear after the first match begins and squad points have been calculated.</p> : loading ? <p role="status" className="text-sm text-[var(--pf-text-muted)]">Searching teams…</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-[var(--pf-coral-text)]">{error}</p> : null}
    {((!displayed && !loading) || error || (displayed?.visible && displayed.rows.length < displayed.total_count)) ?
      <button type="button" disabled={loading} onClick={() => void loadRows(displayed?.rows.length ?? 0, query)}
        className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-4 py-2.5 text-sm font-bold transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-2 focus-visible:outline-[var(--pf-brand-blue)] disabled:opacity-60">
        {loading ? "Loading…" : error ? "Try again" : "Show more teams"}{!loading && !error ? <span aria-hidden="true">↓</span> : null}
      </button> : null}
    <p role="status" className="sr-only">{loading ? "Loading standings" : displayed?.visible ? `${displayed.rows.length} of ${displayed.total_count} teams shown` : ""}</p>
  </div>;
}

"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { LeagueTable } from "@/app/dashboard/league-table";
import { showLeagueCompetitionLink } from "@/lib/competitions";
import type { LeagueStandings, StandingsMode, StandingsWeek } from "@/lib/league-standings";

type Selection = { view: StandingsMode; gameweekId?: string };
const cacheKey = ({ view, gameweekId }: Selection) => view === "global" ? "global" : gameweekId ?? "gameweek";
const cacheLifetime = 30_000;

export function StandingsView({ basePath, userId, weeks, selectedId, initial, weeksError }: {
  basePath: string; userId: string; weeks: StandingsWeek[]; selectedId?: string;
  initial: LeagueStandings; weeksError: boolean;
}) {
  const [selection, setSelection] = useState<Selection>({ view: initial.view, gameweekId: selectedId });
  const [standings, setStandings] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initial.error ?? "");
  const [minHeight, setMinHeight] = useState<number>();
  const panelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // This short-lived cache belongs to this panel, never to another user/session.
  const cache = useRef(new Map<string, { at: number; data: LeagueStandings }>());
  const gameweekMode = selection.view === "gameweek";
  const index = weeks.findIndex((week) => week.gameweek_id === selection.gameweekId);
  const selectedWeek = weeks[index];
  const displayedWeek = weeks.find((week) => week.gameweek_id === standings.gameweekId);
  const showCompetitionLink = standings.view === "gameweek" && displayedWeek && showLeagueCompetitionLink(weeks, standings.gameweekId);
  const status = pending ? "Loading Gameweek…"
    : !selectedWeek || selectedWeek.state === "previous" ? null
      : selectedWeek.state === "open" || selectedWeek.state === "upcoming" ? "Not started" : "In progress";
  // Metadata is newest first: left goes older, right goes newer.
  const previous = weeks[index + 1];
  const next = weeks[index - 1];
  const arrowClass = "flex h-11 w-11 items-center justify-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] disabled:cursor-not-allowed disabled:border-[var(--pf-card-border)] disabled:text-[var(--pf-text-muted)]/35 disabled:hover:bg-[var(--pf-navy-elevated)]";

  function href(target: Selection) {
    const params = new URLSearchParams({ view: target.view });
    if (target.gameweekId) params.set("gameweek", target.gameweekId);
    return `${basePath}?${params}`;
  }

  async function navigate(target: Selection, updateHistory = true, retry = false) {
    if (!retry && !pending && !error && cacheKey(target) === cacheKey(selection) && target.gameweekId === selection.gameweekId) return;
    const height = Math.ceil(panelRef.current?.getBoundingClientRect().height ?? 0);
    setMinHeight((current) => Math.max(current ?? 0, height));
    const requestId = ++requestRef.current;
    abortRef.current?.abort();
    setSelection(target);
    setError("");
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.pathname = basePath;
      url.searchParams.set("view", target.view);
      if (target.gameweekId) url.searchParams.set("gameweek", target.gameweekId);
      else url.searchParams.delete("gameweek");
      if (url.href !== window.location.href) window.history.pushState(null, "", url);
    }
    if (target.view === "gameweek" && (!target.gameweekId || weeksError)) {
      setStandings({ ...initial, view: "gameweek", gameweekId: null, rows: [], total: 0, visible: false, competitionPath: null, error: null });
      setPending(false);
      if (weeksError) setError("Gameweeks are temporarily unavailable. Please reload to try again.");
      return;
    }
    const key = cacheKey(target);
    const cached = cache.current.get(key);
    if (!retry && cached && Date.now() - cached.at < cacheLifetime) {
      setStandings(cached.data);
      setPending(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    try {
      const params = new URLSearchParams({ view: target.view });
      if (target.view === "gameweek" && target.gameweekId) params.set("gameweek", target.gameweekId);
      const response = await fetch(`/api/league-standings?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Standings unavailable");
      const result = await response.json() as LeagueStandings;
      if (requestId !== requestRef.current) return;
      cache.current.delete(key);
      cache.current.set(key, { at: Date.now(), data: result });
      const oldest = cache.current.keys().next().value;
      if (cache.current.size > 16 && oldest) cache.current.delete(oldest);
      setStandings(result);
    } catch {
      if (requestId === requestRef.current) setError("Standings could not be loaded. Your previous standings are still shown.");
    } finally {
      if (requestId === requestRef.current) setPending(false);
    }
  }

  const restoreHistory = useEffectEvent(() => {
    if (window.location.pathname !== basePath) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("gameweek");
    void navigate({ view: params.get("view") === "gameweek" ? "gameweek" : "global",
      gameweekId: id && weeks.some((week) => week.gameweek_id === id) ? id : selectedId }, false);
  });
  const stopRequests = useEffectEvent(() => {
    ++requestRef.current;
    abortRef.current?.abort();
  });

  useEffect(() => {
    if (!initial.error) cache.current.set(cacheKey({ view: initial.view, gameweekId: selectedId }), { at: Date.now(), data: initial });
    const onPopState = () => restoreHistory();
    window.addEventListener("popstate", onPopState);
    // Next can restore a cached server snapshot after visiting a prize page.
    // The native-history URL is authoritative even when those props are older.
    restoreHistory();
    return () => {
      window.removeEventListener("popstate", onPopState);
      stopRequests();
    };
  }, [basePath, initial, selectedId]);

  return <div ref={panelRef} style={{ minHeight, overflowAnchor: "none" }}>
    <h2 className="mb-4 text-xl font-black tracking-tight text-[var(--pf-text)]">Global league</h2>
    <nav aria-label="Standings view" className="mx-auto grid w-full max-w-sm grid-cols-2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] p-1">
      {(["global", "gameweek"] as const).map((mode) => {
        const selected = selection.view === mode;
        const target = { view: mode, gameweekId: selection.gameweekId };
        return <Link key={mode} href={href(target)} prefetch={false} scroll={false} aria-current={selected ? "page" : undefined}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            void navigate(target);
          }}
          className={`flex min-h-10 items-center justify-center rounded-md px-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] ${selected ? "bg-[var(--pf-brand-blue)] text-[var(--pf-text)]" : "text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-text)]"}`}>
          {mode === "global" ? "Season" : "Gameweek"}
        </Link>;
      })}
    </nav>
    {gameweekMode && selectedWeek ? <nav aria-label="Standings Gameweeks" aria-busy={pending}
      className="mx-auto mt-4 grid w-full max-w-sm grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] p-2">
      <button type="button" className={arrowClass} disabled={!previous}
        aria-label={previous ? `Previous: Gameweek ${previous.gameweek_number}` : "No previous Gameweek"}
        onClick={() => previous && void navigate({ view: "gameweek", gameweekId: previous.gameweek_id })}><span aria-hidden="true" className="text-2xl leading-none">‹</span></button>
      <div className="min-w-0 text-center" aria-live="polite">
        <p className="text-sm font-black text-[var(--pf-text)]">Gameweek {selectedWeek.gameweek_number}</p>
        {status ? <p className="mt-0.5 text-xs text-[var(--pf-text-muted)]">{status}</p> : null}
      </div>
      <button type="button" className={arrowClass} disabled={!next}
        aria-label={next ? `Next: Gameweek ${next.gameweek_number}` : "No next Gameweek"}
        onClick={() => next && void navigate({ view: "gameweek", gameweekId: next.gameweek_id })}><span aria-hidden="true" className="text-2xl leading-none">›</span></button>
    </nav> : null}
    {error ? <div className="mt-4 text-sm text-[var(--pf-text-muted)]" role="alert">
      <p>{error}</p>
      {!weeksError || !gameweekMode ? <button type="button" onClick={() => void navigate(selection, false, true)}
        className="mt-1 min-h-11 font-semibold text-[var(--pf-brand-blue-hover)] underline underline-offset-2">Try again</button> : null}
    </div> : null}
    <div className="relative" aria-busy={pending}>
      <div inert={pending} className={`transition-opacity duration-150 motion-reduce:transition-none ${pending ? "opacity-40" : "opacity-100"}`}>
        {standings.error ? null : standings.view === "gameweek" && !standings.gameweekId ? <p className="mt-4 text-sm text-[var(--pf-text-muted)]">No Gameweeks are available yet.</p>
          : !standings.visible ? <p className="mt-4 text-sm leading-6 text-[var(--pf-text-muted)]">This Gameweek has not started. Standings will appear after the first match begins and squad points have been calculated.</p>
            : <LeagueTable key={cacheKey({ view: standings.view, gameweekId: standings.gameweekId ?? undefined })}
                currentUserId={userId} gameweekId={standings.view === "gameweek" ? standings.gameweekId ?? undefined : undefined}
                initialRowCount={5} rows={standings.rows} totalRowCount={standings.total} searchable
                emptyMessage={standings.view === "gameweek" ? "No scored squads yet. Check back after Gameweek results are refreshed." : "No fantasy teams yet."} />}
        {showCompetitionLink && standings.competitionPath ? <Link className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--pf-brand-blue-hover)] underline underline-offset-2" href={standings.competitionPath}>View Gameweek {displayedWeek.gameweek_number} competition →</Link> : null}
      </div>
      {pending ? <p role="status" className="absolute inset-0 flex min-h-20 items-center justify-center text-sm font-semibold text-[var(--pf-text)]">
        <span className="rounded-md bg-[var(--pf-navy)] px-4 py-2">Loading standings…</span>
      </p> : null}
    </div>
  </div>;
}

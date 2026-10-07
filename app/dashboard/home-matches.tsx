"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { canonicalClubName, getClub } from "@/lib/clubs";
import { matchState, type MatchSummary } from "@/lib/match-summary";

const dateHeadingFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Stockholm",
});
const timeFormat = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm",
});
function groupMatchesByDate(matches: MatchSummary[]) {
  const groups = new Map<string, { key: string; label: string; matches: MatchSummary[] }>();
  for (const match of matches) {
    const date = match.starts_at ? new Date(match.starts_at) : null;
    const key = date ? new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Stockholm",
    }).format(date) : "date-tbc";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: date ? dateHeadingFormat.format(date) : "Date TBC",
        matches: [],
      };
      groups.set(key, group);
    }
    group.matches.push(match);
  }
  return [...groups.values()];
}

function Club({ name }: { name: string | null }) {
  const club = name ? getClub(name) : undefined;
  const fullName = canonicalClubName(name ?? "Club TBC");
  return (
    <span className="flex min-w-0 justify-center" title={fullName}>
      {club ? (
        <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-[var(--pf-text)] p-0.5">
          <Image alt="" className="h-6 w-6 object-contain sm:h-7 sm:w-7" height={28} width={28} src={club.logo} />
        </span>
      ) : <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--pf-brand-blue-soft)] text-xs font-black">?</span>}
      <span className="sr-only">{fullName}</span>
    </span>
  );
}

export function HomeMatches({ gameweekId, initialMatches, initialError, initialNow }: {
  gameweekId: string | null;
  initialMatches: MatchSummary[];
  initialError: boolean;
  initialNow: number;
}) {
  const [matches, setMatches] = useState(initialMatches);
  const [failed, setFailed] = useState(initialError);
  const [now, setNow] = useState(initialNow);
  const lastFetchedAt = useRef(initialNow);
  const lastRequestAt = useRef(Number.NEGATIVE_INFINITY);
  const hasPendingMatches = matches.some((match) =>
    !["Final", "Cancelled"].includes(matchState(match, now)));
  const matchGroups = groupMatchesByDate(matches);

  useEffect(() => {
    if (!gameweekId) return;
    if (!hasPendingMatches && !failed && matches.length) return;
    const refreshUrl = `/api/home-matches?gameweek=${encodeURIComponent(gameweekId)}`;
    let controller: AbortController | null = null;
    async function refresh() {
      if (document.visibilityState !== "visible" || controller) return;
      const currentTime = Date.now();
      setNow(currentTime);
      if (performance.now() - lastRequestAt.current < 60_000) return;
      if (!failed && matches.length && matches.every((match) => {
        const state = matchState(match, currentTime);
        return ["Final", "Cancelled"].includes(state) ||
          (state === "Upcoming" && (!match.starts_at || Date.parse(match.starts_at) > currentTime + 300_000));
      }) && currentTime - lastFetchedAt.current < 300_000) return;
      controller = new AbortController();
      lastRequestAt.current = performance.now();
      try {
        const response = await fetch(refreshUrl, {
          signal: controller.signal, cache: "no-store",
        });
        if (!response.ok) throw new Error("Match refresh failed");
        const result = await response.json();
        setMatches(result.matches);
        setFailed(false);
        lastFetchedAt.current = Date.now();
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) setFailed(true);
      } finally {
        controller = null;
      }
    }
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      controller?.abort();
    };
  }, [gameweekId, hasPendingMatches, failed, matches]);

  return (
    <>
      {gameweekId ? (
        <section aria-label="Matches" className="table-panel overflow-hidden rounded-lg border p-3.5 sm:p-5">
          <h2 className="mb-3 text-xl font-black leading-tight sm:text-2xl">Upcoming matches</h2>
          {matches.length ? (
            <div className="space-y-4">
              {matchGroups.map((group) => (
                <section key={group.key} aria-label={group.label}>
                  <h3 className="mb-1.5 border-b border-[var(--pf-card-border)] pb-1 text-[11px] font-black uppercase tracking-[0.12em] text-[var(--pf-text-muted)]">
                    {group.label}
                  </h3>
                  <ul className="space-y-1">
                    {group.matches.map((match) => {
                      const state = matchState(match, now);
                      const isLive = state === "Live";
                      const showScore = isLive || (state === "Final" && match.home_score + match.away_score > 0);
                      return (
                        <li key={match.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)_2.25rem] items-center gap-1.5 py-1 sm:grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] sm:gap-2">
                          <div className="flex flex-col leading-tight">
                            {isLive ? (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-black text-[var(--pf-fantasy-yellow)] sm:text-base">
                                <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
                                  <span className="match-live-dot absolute inline-flex h-full w-full rounded-full bg-[var(--pf-fantasy-yellow)]" />
                                  <span className="relative inline-flex h-full w-full rounded-full bg-[var(--pf-fantasy-yellow)]" />
                                </span>
                                LIVE
                              </span>
                            ) : match.starts_at ? (
                              <time dateTime={match.starts_at} title="Europe/Stockholm" className="whitespace-nowrap text-sm font-semibold tabular-nums text-[var(--pf-text)] sm:text-base">
                                {timeFormat.format(new Date(match.starts_at))}
                              </time>
                            ) : <span className="text-[10px] font-medium text-[var(--pf-text-muted)]">Time TBC</span>}
                          </div>
                          <div className="inline-grid w-fit max-w-full grid-cols-[1.75rem_2.75rem_1.75rem] items-center justify-center gap-x-1.5 justify-self-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] px-1.5 py-1 sm:grid-cols-[2rem_3.5rem_2rem] sm:gap-x-3 sm:px-3">
                            <Club name={match.home_team_name} />
                            <span className="flex flex-col items-center justify-center">
                              <span aria-label={showScore ? `Home ${match.home_score}, away ${match.away_score}` : undefined} className={`flex items-center justify-center gap-1 whitespace-nowrap text-lg font-black leading-6 tabular-nums sm:text-xl ${isLive ? "text-[var(--pf-fantasy-yellow)]" : "text-[var(--pf-text)]"}`}>
                                {showScore ? <><span>{match.home_score}</span><span aria-hidden="true">–</span><span>{match.away_score}</span></> : state === "Upcoming" ? <span className="text-xs text-[var(--pf-text-muted)]">vs</span> : "—"}
                              </span>
                              {state !== "Final" && state !== "Upcoming" && !isLive ? <span className="text-center text-[8px] font-bold leading-tight text-[var(--pf-text-muted)]">{state}</span> : null}
                            </span>
                            <Club name={match.away_team_name} />
                          </div>
                          {match.stream_url && state !== "Cancelled" ? (
                            <a href={match.stream_url} target="_blank" rel="noopener noreferrer" title="Watch stream" aria-label={`Watch ${canonicalClubName(match.home_team_name ?? "home")} vs ${canonicalClubName(match.away_team_name ?? "away")} stream (opens in new tab)`} className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--pf-brand-blue-hover)] focus-visible:outline-2 focus-visible:outline-[var(--pf-brand-blue)] sm:h-10 sm:w-10">
                              <span className="flex h-[30px] w-[30px] items-center justify-center transition group-hover:text-[var(--pf-brand-blue)]">
                                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="4" width="20" height="16" rx="4" /><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none" /></svg>
                              </span>
                            </a>
                          ) : <span className="w-9 shrink-0 text-center text-[9px] leading-tight text-[var(--pf-text-muted)] sm:w-10 sm:text-[10px]">No stream</span>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : <p className="text-sm text-[var(--pf-text-muted)]">{failed ? "Matches could not be loaded. Retrying automatically." : "Match details to be confirmed."}</p>}
          {failed && matches.length ? <p role="status" className="pt-2 text-[10px] text-[var(--pf-text-muted)]">Update unavailable · showing last received scores. Retrying automatically.</p> : null}
        </section>
      ) : null}
    </>
  );
}

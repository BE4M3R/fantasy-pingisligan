import Link from "next/link";
import type { ReactNode } from "react";
import { getCompetitionHighlights } from "@/lib/competition-highlights";
import { competitionsEnabled } from "@/lib/competition-publication";
import { competitionDisplayTitle, competitionStatus, gameweekCompetitionTitle, type CompetitionWinner } from "@/lib/competitions";
import { formatPrizeRevealDate, type HomepageCompetition } from "@/lib/homepage-banners";
import { createClient } from "@/lib/supabase/server";
import { CompetitionIcon } from "./competition-icon";

type GameweekState = "upcoming" | "open" | "live" | "refreshing" | "previous";
type Entry = {
  competition: HomepageCompetition;
  state: HomepageCompetition["state"];
  href: string | null;
  winner: CompetitionWinner | null;
};

const mutedText = "text-sm text-[var(--pf-text-muted)]";
const panelClass = "rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)]";
const linkClass = "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue-hover)]";

function Notice({ children }: { children: ReactNode }) {
  return <p className={`${panelClass} ${mutedText} p-4`}>{children}</p>;
}

function CompetitionCard({ entry, featured = false }: { entry: Entry; featured?: boolean }) {
  const { competition, state, href, winner } = entry;
  const season = competition.kind === "season";
  const locked = competition.state === "upcoming";
  const defaultTitle = season ? "Season Competition" : gameweekCompetitionTitle(competition.gameweek_number);
  const title = locked ? defaultTitle : competitionDisplayTitle(competition.title);
  const prize = locked ? null : competition.prize_title;
  const sponsor = locked ? null : competition.sponsor;
  const revealDate = locked ? formatPrizeRevealDate(competition.prize_reveal_at) : undefined;
  const status = state === "previous" ? "Completed" : competitionStatus({ gameweek_number: competition.gameweek_number, state });
  const standings = !season && (state === "live" || state === "refreshing" || state === "previous");

  return (
    <article className={`${panelClass} min-w-0 overflow-hidden ${featured ? "border-[var(--pf-logo-gold)]/35" : ""}`}>
      <div className={featured ? "sponsored-slide relative p-4 sm:p-6" : "p-4"}>
        <div className="relative flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <h3 className={`flex min-w-0 items-center gap-2 text-base font-bold [overflow-wrap:anywhere] ${featured ? "text-[var(--pf-logo-gold)]" : ""}`}>
            {featured || season ? <CompetitionIcon className="h-5 w-5 shrink-0" season={season} /> : null}
            <span>{title}{!season && title !== defaultTitle ? ` · Gameweek ${competition.gameweek_number}` : ""}</span>
          </h3>
          <p className="rounded-full bg-[var(--pf-navy-deep)] px-2.5 py-1 text-xs font-semibold text-[var(--pf-text-muted)]">{status}</p>
        </div>
        <p className={`relative mt-2 font-bold [overflow-wrap:anywhere] ${featured ? "text-2xl sm:text-3xl" : "text-sm"}`}>
          {prize ?? (locked ? competition.teaser : null) ?? "Prize details coming soon"}
        </p>
        {sponsor ? <p className={`relative mt-1 [overflow-wrap:anywhere] ${mutedText}`}>Sponsored by <strong className="text-[var(--pf-text)]">{sponsor}</strong></p> : null}
        {revealDate ? <p className={`relative mt-2 ${mutedText}`}>Prize reveal <time dateTime={competition.prize_reveal_at ?? undefined}>{revealDate}</time> (Stockholm time)</p> : null}
        {winner ? <p className="relative mt-2 text-sm font-semibold text-[var(--pf-logo-gold)] [overflow-wrap:anywhere]">Winner · {winner.team_name}</p> : null}
        {href ? <div className="relative mt-3 flex flex-wrap items-center gap-2">
          <Link href={href} aria-label={`View competition for ${title}`} className={`${linkClass} bg-[var(--pf-brand-blue)] text-[var(--pf-navy-deep)] hover:bg-[var(--pf-brand-blue-hover)]`}>View competition</Link>
          {standings ? <Link href={`${href}#standings-heading`} aria-label={`View standings for ${title}`} className={`${linkClass} text-[var(--pf-brand-blue-hover)] hover:bg-[var(--pf-brand-blue-soft)]`}>View standings</Link> : null}
        </div> : null}
      </div>
    </article>
  );
}

function CompetitionSection({ id, heading, entries, empty, featured = false }: {
  id: string; heading: string; entries: Entry[]; empty?: string; featured?: boolean;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-lg font-bold sm:text-xl">{heading}</h2>
      {entries.length ? <ul className={`grid gap-3 ${featured ? "" : "sm:grid-cols-2"}`}>
        {entries.map((entry, index) => (
          <li key={entry.competition.id}><CompetitionCard entry={entry} featured={featured && index === 0} /></li>
        ))}
      </ul> : <Notice>{empty}</Notice>}
    </section>
  );
}

export async function CompetitionOverview() {
  if (!await competitionsEnabled()) return <Notice>Competitions are currently unavailable.</Notice>;

  const supabase = await createClient();
  const [{ rows, error, winners, winnerError }, gameweeks, routes] = await Promise.all([
    getCompetitionHighlights(),
    supabase.rpc("homepage_gameweek_states").select("gameweek_id,state,is_current"),
    supabase.rpc("competition_gameweek_routes").select("gameweek_id,public_path"),
  ]);
  if (error || gameweeks.error || routes.error) {
    return <div role="status"><Notice>Competitions could not be loaded. Please try again.</Notice></div>;
  }

  // The banner state describes prize visibility. The Fantasy state keeps
  // completed or active rounds in their section even with a late prize reveal.
  const lifecycle = new Map((gameweeks.data as { gameweek_id: string; state: GameweekState; is_current: boolean }[]).map((week) =>
    [`gameweek:${week.gameweek_id}`, week],
  ));
  const paths = new Map((routes.data as { gameweek_id: string; public_path: string }[]).map((route) =>
    [`gameweek:${route.gameweek_id}`, route.public_path],
  ));
  const current: Entry[] = [];
  const upcoming: Entry[] = [];
  const previous: Entry[] = [];
  const season: Entry[] = [];

  for (const competition of rows) {
    if (competition.kind === "season") {
      season.push({ competition, state: competition.state, href: "/competitions/season", winner: null });
      continue;
    }
    const week = lifecycle.get(competition.id);
    const path = paths.get(competition.id);
    if (!week || !path) continue;
    const { state } = week;
    const entry = {
      competition,
      state,
      href: state === "upcoming" ? competition.cta_url : path,
      winner: state === "previous" ? winners.get(competition.id) ?? null : null,
    };
    if (state === "previous") previous.push(entry);
    else if (state === "upcoming") upcoming.push(entry);
    else if (week.is_current) current.unshift(entry);
    else current.push(entry);
  }

  return (
    <div className="space-y-6">
      <CompetitionSection id="current-competition" heading="Current Gameweek Competition" entries={current} empty="There is no current Gameweek competition." featured />
      <CompetitionSection id="upcoming-competitions" heading="Upcoming Competitions" entries={upcoming} empty="No upcoming Gameweek competitions have been announced." />
      {winnerError ? <p role="status" className={mutedText}>Winner announcements temporarily unavailable.</p> : null}
      <CompetitionSection id="previous-competitions" heading="Previous Competitions & Winners" entries={previous.reverse()} empty="There are no completed Gameweek competitions yet." />
      {season.length ? <CompetitionSection id="season-competition" heading="Season Competition" entries={season} /> : null}
    </div>
  );
}

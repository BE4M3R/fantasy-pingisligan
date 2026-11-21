import Link from "next/link";
import type { ReactNode } from "react";
import { getCompetitionHighlights, getCompetitionSponsorUrls } from "@/lib/competition-highlights";
import { competitionsEnabled } from "@/lib/competition-publication";
import { competitionDisplayTitle, gameweekCompetitionTitle, type CompetitionWinner } from "@/lib/competitions";
import { formatPrizeRevealDate, type HomepageCompetition } from "@/lib/homepage-banners";
import { createClient } from "@/lib/supabase/server";
import { CompetitionChevron, CompetitionIcon } from "./competition-icon";
import { PrizeRevealCard } from "./prize-reveal-card";
import { CompetitionSponsorLogo } from "./sponsor-logo";
import { CompetitionStatusBadge } from "./status-badge";

type GameweekState = "upcoming" | "open" | "live" | "refreshing" | "previous";
type CompetitionEntry = {
  competition: HomepageCompetition;
  href?: string;
  sponsorUrl?: string;
};

type HallOfFameEntry = {
  competition: HomepageCompetition;
  href: string;
  winner: CompetitionWinner | null;
};

const mutedText = "text-sm text-[var(--pf-text-muted)]";
const panelClass = "rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)]";
const subheadingClass = "mb-2 text-sm font-bold text-[var(--pf-text-muted)] sm:text-base";
const cardGridClass = "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4";
const cardLinkClass = `group ${cardGridClass} transition-colors hover:bg-[var(--pf-brand-blue)]/10 active:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pf-brand-blue-hover)] motion-reduce:transition-none`;

function Notice({ children }: { children: ReactNode }) {
  return <p className={`${panelClass} ${mutedText} p-4`}>{children}</p>;
}

function CardArrow() {
  return <CompetitionChevron className="h-6 w-6 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-1" />;
}

function CompetitionCard({ entry, featured = false }: { entry: CompetitionEntry; featured?: boolean }) {
  const { competition, href, sponsorUrl } = entry;
  const season = competition.kind === "season";
  const locked = competition.state === "upcoming";
  const defaultTitle = season ? "Season Competition" : gameweekCompetitionTitle(competition.gameweek_number);
  const title = locked ? defaultTitle : competitionDisplayTitle(competition.title);
  const prize = locked ? null : competition.prize_title;
  const sponsor = locked ? null : competition.sponsor;
  const revealDate = locked ? formatPrizeRevealDate(competition.prize_reveal_at) : undefined;
  const cardClass = `relative h-full ${featured ? "px-5 py-[1.125rem] sm:px-8 sm:py-[1.8rem]" : "p-4"}`;
  const detailSpacing = featured ? "mt-[0.45rem]" : "mt-2";
  const copy = (
    <>
      <div className="col-span-2 flex min-w-0 items-start justify-between gap-2">
        <h3 className={`flex min-w-0 items-center gap-2 font-bold [overflow-wrap:anywhere] ${featured ? "text-sm text-[var(--pf-logo-gold)] sm:text-base" : "text-base"}`}>
          {featured || season ? <CompetitionIcon className="h-5 w-5 shrink-0" season={season} /> : null}
          <span>{title}{!season && title !== defaultTitle ? ` · Gameweek ${competition.gameweek_number}` : ""}</span>
        </h3>
        {!season ? <CompetitionStatusBadge state={competition.state} /> : null}
      </div>
      <div className={`${detailSpacing} min-w-0 [overflow-wrap:anywhere]`}>
        <p className={featured ? "text-2xl font-black leading-tight tracking-tight sm:text-3xl" : "text-sm font-bold"}>
          {prize ?? competition.teaser ?? "Prize details coming soon"}
        </p>
        {sponsorUrl || sponsor ? (
          <div className={`flex min-w-0 items-center gap-3 ${featured ? "mt-[0.9rem]" : "mt-2"}`}>
            {sponsorUrl ? <CompetitionSponsorLogo key={sponsorUrl} src={sponsorUrl} alt={competition.image_alt ?? sponsor ?? "Sponsor logo"} eager={featured} /> : null}
            {sponsor ? <p className={`min-w-0 ${mutedText}`}>Sponsored by <strong className="text-[var(--pf-text)]">{sponsor}</strong></p> : null}
          </div>
        ) : null}
        {revealDate ? <p className={`${detailSpacing} ${mutedText}`}>Prize reveal <time dateTime={competition.prize_reveal_at ?? undefined}>{revealDate}</time></p> : null}
      </div>
    </>
  );

  return (
    <article className={`relative h-full min-w-0 overflow-hidden rounded-xl border bg-[var(--pf-navy)] ${featured ? "sponsored-slide border-[var(--pf-logo-gold)]/35" : "border-[var(--pf-card-border)]"}`}>
      {href ? (
        <Link href={href} prefetch={false} className={`${cardLinkClass} ${cardClass}`}>
          {copy}
          <CardArrow />
        </Link>
      ) : <div className={`${cardGridClass} ${cardClass}`}>{copy}</div>}
    </article>
  );
}

function CompetitionSection({ id, heading, entries, empty, featured = false }: {
  id: string; heading: string; entries: CompetitionEntry[]; empty?: string; featured?: boolean;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={subheadingClass}>{heading}</h2>
      {entries.length ? <ul className={`grid gap-3 ${featured ? "" : "sm:grid-cols-2"}`}>
        {entries.map((entry, index) => (
          <li key={entry.competition.id}><CompetitionCard entry={entry} featured={featured && index === 0} /></li>
        ))}
      </ul> : <Notice>{empty}</Notice>}
    </section>
  );
}

function UpcomingCompetitions({ entries }: { entries: HomepageCompetition[] }) {
  return (
    <section aria-labelledby="upcoming-competitions">
      <h2 id="upcoming-competitions" className={subheadingClass}>Upcoming competitions</h2>
      {entries.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {entries.map((competition) => {
            const label = `Gameweek ${competition.gameweek_number}`;
            const locked = competition.state === "upcoming";
            const revealDate = locked ? formatPrizeRevealDate(competition.prize_reveal_at) : undefined;
            const prize = locked ? null : competition.prize_title;
            return (
              <li key={competition.id} className={panelClass}>
                <PrizeRevealCard
                  className={`${cardLinkClass} h-full min-h-12 w-full cursor-pointer rounded-xl px-3 py-2 text-left`}
                  gameweek={label}
                  teaser={competition.teaser ?? "Prize details coming soon"}
                  title={prize ? `${label} prize` : `${label} prize reveal`}
                >
                  {revealDate ? (
                    <p><time dateTime={competition.prize_reveal_at ?? undefined} className="text-sm font-semibold text-[var(--pf-text)]">{revealDate}</time></p>
                  ) : <p>{prize ?? (competition.prize_reveal_at
                    ? "Prize details will appear when they’re ready."
                    : "Prize details will appear when the Gameweek is current and the prize is ready.")}</p>}
                </PrizeRevealCard>
              </li>
            );
          })}
        </ul>
      ) : <Notice>No upcoming Gameweek competitions have been announced.</Notice>}
    </section>
  );
}

function CompetitionHallOfFame({ entries, winnerError }: { entries: HallOfFameEntry[]; winnerError: boolean }) {
  return (
    <section aria-labelledby="competition-hall-of-fame">
      <h2 id="competition-hall-of-fame" className={subheadingClass}>Hall of Fame</h2>
      {winnerError ? <p role="status" className={`mb-2 ${mutedText}`}>Winner announcements temporarily unavailable.</p> : null}
      {entries.length ? (
        <ul className={`${panelClass} divide-y divide-[var(--pf-card-border)]/50 overflow-hidden`}>
          {entries.map(({ competition, href, winner }) => (
            <li key={competition.id}>
              <Link href={href} prefetch={false} className={`${cardLinkClass} min-h-12 px-4 py-2 sm:px-6`}>
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <h3 className="text-xs font-medium leading-tight text-[var(--pf-text-muted)]">Gameweek {competition.gameweek_number}</h3>
                  {winner ? (
                    <p className="mt-0.5 flex min-w-0 items-start gap-1.5 text-sm font-semibold leading-tight">
                      <CompetitionIcon className="h-4 w-4 shrink-0 text-[var(--pf-logo-gold)]" />
                      <span className="min-w-0">{winner.team_name}</span>
                    </p>
                  ) : <p className={mutedText}>{winnerError ? "Winner unavailable" : "Winner to be announced"}</p>}
                </div>
                <CardArrow />
              </Link>
            </li>
          ))}
        </ul>
      ) : <Notice>There are no completed Gameweek competitions yet.</Notice>}
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
  const current: CompetitionEntry[] = [];
  const upcoming: HomepageCompetition[] = [];
  const previous: HallOfFameEntry[] = [];
  const season: CompetitionEntry[] = [];

  for (const competition of rows) {
    if (competition.kind === "season") {
      season.push({
        competition,
        href: competition.state === "revealed" ? "/competitions/season" : undefined,
      });
      continue;
    }
    const week = lifecycle.get(competition.id);
    const path = paths.get(competition.id);
    if (!week || !path) continue;
    const { state } = week;
    if (state === "previous") {
      previous.push({ competition, href: path, winner: winners.get(competition.id) ?? null });
    } else if (state === "upcoming") {
      upcoming.push(competition);
    } else if (week.is_current) {
      current.unshift({ competition, href: path });
    } else {
      current.push({ competition, href: path });
    }
  }

  const featured = current[0];
  if (featured && featured.competition.state !== "upcoming" && featured.competition.image_path) {
    const { image_path } = featured.competition;
    const urls = await getCompetitionSponsorUrls([image_path]);
    featured.sponsorUrl = urls.get(image_path);
  }

  return (
    <div className="space-y-6">
      <CompetitionSection id="current-competition" heading="Current competition" entries={current} empty="There is no current Gameweek competition." featured />
      <UpcomingCompetitions entries={upcoming} />
      <CompetitionHallOfFame entries={previous.reverse()} winnerError={Boolean(winnerError)} />
      {season.length ? <CompetitionSection id="season-competition" heading="Season Competition" entries={season} /> : null}
    </div>
  );
}

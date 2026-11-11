import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { Suspense } from "react";
import { getClaims } from "@/lib/supabase/server";
import { PublicFooter } from "@/app/public-footer";
import { SafeMarkdown } from "@/app/safe-markdown";
import { competitionStatus, formatPrizeValue, gameweekCompetitionTitle, type Competition, type CompetitionStandings as Standings } from "@/lib/competitions";
import { CompetitionArtwork as Artwork } from "./artwork";
import { CompetitionStandings } from "./standings";
import { CompetitionReturnLink } from "./return-link";

export function CompetitionPage({ competition: c, artwork = {}, gameweekId, standings }: {
  competition: Competition; artwork?: Record<string, string | undefined>;
  gameweekId: string | null; standings: Standings | null;
}) {
  const season = c.gameweek_number === null;
  const status = competitionStatus(c);
  const prizeValue = formatPrizeValue(c.prize_value_sek);
  const panel = "min-w-0 rounded-2xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-5 sm:p-7";
  return <CompetitionShell>
    <section className="overflow-hidden rounded-2xl border border-[var(--pf-logo-gold)]/35 bg-[var(--pf-navy)]" aria-labelledby="competition-heading">
      <div className={`sponsored-slide relative px-5 py-5 sm:px-8 sm:py-7 ${season ? "sponsored-slide-season" : ""}`}>
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold uppercase tracking-widest">
            <span className="flex min-w-0 items-center gap-2 text-[var(--pf-logo-gold)]"><CompetitionIcon season={season} /><span className="break-words">{c.title}{!season && c.title !== gameweekCompetitionTitle(c.gameweek_number) ? ` · Gameweek ${c.gameweek_number}` : ""}</span></span>
            <span className="shrink-0 rounded-full border border-[var(--pf-brand-blue-hover)]/30 bg-[var(--pf-navy)]/60 px-3 py-1.5 text-[var(--pf-text)]">{status}</span>
          </div>
          <h1 id="competition-heading" className={`mt-4 max-w-3xl break-words text-3xl font-black leading-tight tracking-tight sm:text-5xl ${season ? "text-[var(--pf-logo-gold)]" : ""}`}>{c.description ?? "Prize details coming soon"}</h1>
          {c.sponsor ? <p className="mt-3 break-words text-sm text-[var(--pf-text-muted)]">Sponsored by <span className="font-bold text-[var(--pf-text)]">{c.sponsor}</span></p> : null}
          {prizeValue ? <p className="mt-2 text-sm font-bold text-[var(--pf-logo-gold)]">Approximate value: {prizeValue}</p> : null}
        </div>
      </div>
      <div className="grid items-center gap-4 p-5 sm:gap-6 sm:p-8 lg:grid-cols-[1fr_1.1fr] lg:gap-8">
        {c.prize_image_path && artwork[c.prize_image_path] ?
          <Artwork key={c.prize_image_path} src={artwork[c.prize_image_path]} alt={c.prize_image_alt ?? c.description ?? "Competition prize"} productUrl={c.prize_product_url} /> :
          <div className="flex h-36 items-center justify-center rounded-xl bg-[var(--pf-navy-elevated)] text-[var(--pf-text-muted)] sm:h-64">
            <div className="text-center"><span aria-hidden="true" className="text-3xl text-[var(--pf-logo-gold)]">★</span><p className="mt-2 text-sm">Prize reveal coming soon</p></div>
          </div>}
        <div className="space-y-5">
          {c.prize_description ? <SafeMarkdown>{c.prize_description}</SafeMarkdown> : null}
          <Link href="/rules#competition-rules" className="inline-flex min-h-11 items-center text-sm font-bold text-[var(--pf-brand-blue-hover)] underline underline-offset-2">Competition rules and policy</Link>
        </div>
      </div>
    </section>

    {gameweekId ? <section className={panel} aria-labelledby="standings-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="standings-heading" className="text-xl font-bold sm:text-2xl">Competition leaderboard</h2>
          <span className="rounded-full border border-[var(--pf-logo-gold)]/25 bg-[var(--pf-logo-gold)]/10 px-3 py-1 text-xs font-bold text-[var(--pf-logo-gold)]">Provisional</span>
        </div>
        <CompetitionStandings key={gameweekId} gameweekId={gameweekId} initial={standings} />
    </section> : null}
  </CompetitionShell>;
}

function CompetitionIcon({ season }: { season: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 shrink-0">
    <path d={season ? "m3 6 5 4 4-6 4 6 5-4-2 12H5L3 6Zm3 15h12" : "M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 13v5m-4 3h8m-6-3h4l1 3H9l1-3Z"} />
  </svg>;
}

const navigationClassName = "shrink-0 rounded-lg bg-[var(--pf-logo-gold)] px-4 py-3 text-sm font-bold text-[var(--pf-navy-deep)] hover:bg-[var(--pf-logo-gold-hover)]";

async function CompetitionNavigation() {
  // Only this small navigation action depends on auth. Public page reads and
  // standings keep the same anonymous projection for every visitor.
  const [{ data }, requestHeaders] = await Promise.all([getClaims(), headers()]);
  let fromDashboard = false;
  try {
    const referer = new URL(requestHeaders.get("referer") ?? "");
    fromDashboard = referer.host === requestHeaders.get("host") &&
      (referer.pathname === "/dashboard" || referer.pathname.startsWith("/dashboard/"));
  } catch {
    // No usable same-site origin hint: the link uses its normal fallback.
  }
  return <CompetitionReturnLink signedIn={Boolean(data?.claims.sub)} fromDashboard={fromDashboard} className={navigationClassName} />;
}

export function CompetitionShell({ children }: { children: React.ReactNode }) {
  return <main className="table-tennis-surface flex min-h-screen flex-col text-[var(--pf-text)]">
    <header className="border-b border-white/15 bg-[var(--pf-navy-deep)]/70">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6">
        <Link href="/" aria-label="Pingisligan Fantasy home" className="flex min-w-0 items-center gap-2">
          <Image src="/branding/pingisligan-fantasy-mark-transparent-v2.png" width={40} height={40} alt="" className="h-7 w-7 shrink-0 sm:h-10 sm:w-10" unoptimized />
          <Image src="/branding/pingisligan-fantasy-wordmark-transparent-v2.png" width={138} height={31} alt="" className="h-auto w-[100px] shrink-0 sm:w-[138px]" unoptimized />
        </Link>
        <Suspense fallback={<Link href="/dashboard/overview" className={navigationClassName}>Fantasy</Link>}>
          <CompetitionNavigation />
        </Suspense>
      </nav>
    </header>
    <div className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-6 sm:px-6 sm:py-10">{children}</div>
    <PublicFooter />
  </main>;
}

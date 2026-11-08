import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { Suspense } from "react";
import { getClaims } from "@/lib/supabase/server";
import { PublicFooter } from "@/app/public-footer";
import { SafeMarkdown } from "@/app/safe-markdown";
import { competitionResult, competitionStatus, formatPrizeValue, type Competition, type CompetitionStandings as Standings } from "@/lib/competitions";
import { CompetitionArtwork as Artwork } from "./artwork";
import { CompetitionStandings } from "./standings";
import { CompetitionReturnLink } from "./return-link";
import { CompetitionRules } from "./rules";

export function CompetitionPage({ competition: c, artwork = {}, gameweekId, standings }: {
  competition: Competition; artwork?: Record<string, string | undefined>;
  gameweekId: string | null; standings: Standings | null;
}) {
  const season = c.gameweek_number === null;
  const status = competitionStatus(c);
  const result = competitionResult(c);
  const prizeValue = formatPrizeValue(c.prize_value_sek);
  const conditions = c.details_markdown?.trim();
  const panel = "min-w-0 rounded-2xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-5 sm:p-7";
  return <CompetitionShell>
    <section className="overflow-hidden rounded-2xl border border-[var(--pf-logo-gold)]/35 bg-[var(--pf-navy)]" aria-labelledby="competition-heading">
      <div className={`sponsored-slide relative px-5 py-5 sm:px-8 sm:py-7 ${season ? "sponsored-slide-season" : ""}`}>
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold uppercase tracking-widest">
            <span className="flex min-w-0 items-center gap-2 text-[var(--pf-logo-gold)]"><CompetitionIcon season={season} /><span className="break-words">{c.title}{!season ? ` · Gameweek ${c.gameweek_number}` : ""}</span></span>
            <span className="shrink-0 rounded-full border border-[var(--pf-brand-blue-hover)]/30 bg-[var(--pf-navy)]/60 px-3 py-1.5 text-[var(--pf-text)]">{status}</span>
          </div>
          <h1 id="competition-heading" className={`mt-4 max-w-3xl break-words text-3xl font-black leading-tight tracking-tight sm:text-5xl ${season ? "text-[var(--pf-logo-gold)]" : ""}`}>{c.prize_title ?? "Prize details coming soon"}</h1>
          {c.sponsor ? <p className="mt-3 break-words text-sm text-[var(--pf-text-muted)]">Sponsored by <span className="font-bold text-[var(--pf-text)]">{c.sponsor}</span></p> : null}
          {prizeValue ? <p className="mt-2 text-sm font-bold text-[var(--pf-logo-gold)]">Approximate value: {prizeValue}</p> : null}
        </div>
      </div>
      <div className="grid items-center gap-4 p-5 sm:gap-6 sm:p-8 lg:grid-cols-[1fr_1.1fr] lg:gap-8">
        {c.prize_image_path && artwork[c.prize_image_path] ?
          <Artwork key={c.prize_image_path} src={artwork[c.prize_image_path]} alt={c.prize_image_alt ?? c.prize_title ?? "Competition prize"} productUrl={c.prize_product_url} /> :
          <div className="flex h-36 items-center justify-center rounded-xl bg-[var(--pf-navy-elevated)] text-[var(--pf-text-muted)] sm:h-64">
            <div className="text-center"><span aria-hidden="true" className="text-3xl text-[var(--pf-logo-gold)]">★</span><p className="mt-2 text-sm">Prize reveal coming soon</p></div>
          </div>}
        {c.prize_description ? <SafeMarkdown>{c.prize_description}</SafeMarkdown> :
          c.description ? <p className="text-sm leading-6 text-[var(--pf-text-muted)]">{c.description}</p> : null}
      </div>
    </section>

    <section className={panel} aria-labelledby={gameweekId ? "standings-heading" : "result-heading"}>
      {gameweekId ? <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="standings-heading" className="text-xl font-bold sm:text-2xl">Gameweek standings</h2>
          <span className="rounded-full border border-[var(--pf-logo-gold)]/25 bg-[var(--pf-logo-gold)]/10 px-3 py-1 text-xs font-bold text-[var(--pf-logo-gold)]">Provisional</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--pf-text-muted)]">Gameweek points including captains, chips and transfer deductions. Equal scores share a rank.</p>
        <CompetitionStandings key={gameweekId} gameweekId={gameweekId} initial={standings} />
        <div className="mt-4 border-t border-[var(--pf-card-border)] pt-4">
          <h3 className="text-sm font-bold text-[var(--pf-logo-gold)]">Winner announcement</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--pf-text-muted)]">{result.message}</p>
        </div>
      </> : <>
        <h2 id="result-heading" className="flex items-center gap-2 text-xl font-bold text-[var(--pf-logo-gold)]"><CompetitionIcon season />Season winner</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--pf-text-muted)]">{result.message}</p>
      </>}
    </section>
    <section className={panel} aria-labelledby="terms-heading">
      <h2 id="terms-heading" className="text-lg font-bold">Rules and practical information</h2>
      <CompetitionRules body={c.rules_markdown} title={c.rules_title} version={c.rules_version} conditions={conditions} />
    </section>
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
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-6">
        <Link href="/" aria-label="Pingisligan Fantasy home" className="flex min-w-0 items-center gap-2">
          <Image src="/branding/pingisligan-fantasy-mark-transparent-v2.png" width={40} height={40} alt="" unoptimized />
          <span className="text-sm font-black sm:text-base">Pingisligan Fantasy</span>
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

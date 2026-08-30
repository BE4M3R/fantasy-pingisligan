import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PublicFooter } from "@/app/public-footer";

export const metadata: Metadata = {
  title: "About | Fantasy Pingisligan",
  description:
    "Learn how Fantasy Pingisligan turns real Pingisligan matches into a fantasy table tennis game.",
};

export default function AboutPage() {
  return (
    <main className="table-tennis-surface flex min-h-screen flex-col text-[var(--pf-text)]">
      <header className="border-b border-white/15 bg-[var(--pf-navy-deep)]/70 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <Link
            aria-label="Fantasy Pingisligan start page"
            className="flex min-w-0 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-text)]"
            href="/"
          >
            <Image
              alt=""
              className="h-10 w-10 shrink-0 sm:h-11 sm:w-11"
              height={44}
              priority
              src="/branding/pingisligan-fantasy-mark-transparent-v2.png"
              unoptimized
              width={44}
            />
            <Image
              alt=""
              className="h-auto w-[132px] shrink-0 sm:w-[154px]"
              height={35}
              priority
              src="/branding/pingisligan-fantasy-wordmark-transparent-v2.png"
              unoptimized
              width={154}
            />
          </Link>
          <Link
            className="shrink-0 rounded-md border border-white/25 bg-white/5 px-3 py-2 text-sm font-bold text-[var(--pf-text)] transition hover:border-white/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy-deep)] sm:px-4"
            href="/"
          >
            Back to start
          </Link>
        </nav>
      </header>

      <section className="mx-auto flex w-full max-w-4xl flex-1 items-center px-5 py-10 sm:px-6 sm:py-16">
        <article className="table-panel w-full rounded-xl border p-6 sm:p-10">
          <p className="text-sm font-bold uppercase tracking-widest text-[var(--pf-brand-blue)]">
            About the game
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-[var(--pf-text)] sm:text-5xl">
            Fantasy table tennis, powered by real Pingisligan matches
          </h1>

          <div className="mt-6 space-y-5 text-base leading-7 text-[var(--pf-text-muted)]">
            <p>
              Fantasy Pingisligan is a fantasy game based on Pingisligan, the
              highest Swedish table tennis division. Build a squad from the
              league&apos;s players and follow their real performances throughout
              the season.
            </p>
            <p>
              Choose six players within your budget, select four starters and
              appoint a captain. Your team earns points from match wins, sets,
              doubles results and club performances in each gameweek.
            </p>
            <p>
              Make transfers as the season develops, use special fantasy chips
              at the right moment and create private leagues to compete with your
              friends.
            </p>
          </div>

          <div className="mt-8">
            <Link
              className="inline-flex rounded-lg bg-[var(--pf-logo-gold)] px-6 py-3 font-black text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-logo-gold-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--pf-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy-deep)]"
              href="/signup"
            >
              Build your team
            </Link>
          </div>
        </article>
      </section>

      <PublicFooter />
    </main>
  );
}

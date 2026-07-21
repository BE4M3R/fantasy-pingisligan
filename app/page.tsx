import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CLUB_LOGOS } from "@/app/dashboard/club-logos";
import { SeasonBanner } from "@/app/season-banner";
import { createClient } from "@/lib/supabase/server";

export default function Home() {
  return <HomeContent />;
}

async function HomeContent() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (claims?.sub) {
    redirect("/dashboard/overview");
  }

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <header className="border-b border-white/15 bg-sky-950/70 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link className="font-bold text-sky-100" href="/">
            Fantasy Pingisligan
          </Link>
          <div className="flex items-center gap-3">
            <Link
              className="rounded-md px-3 py-2 text-sm font-semibold text-sky-100/75 transition hover:text-white"
              href="/rules"
            >
              Rules
            </Link>
            <Link
              className="rounded-md px-3 py-2 text-sm font-semibold text-sky-100/75 transition hover:text-white"
              href="/login"
            >
              Log in
            </Link>
            <Link
              className="rounded-md bg-sky-100 px-4 py-2 text-sm font-bold text-sky-950 transition hover:bg-white"
              href="/signup"
            >
              Sign up
            </Link>
          </div>
        </nav>
      </header>

      <section className="relative mx-auto grid min-h-[calc(100vh-73px)] max-w-6xl content-center gap-10 overflow-hidden px-6 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 top-6 flex items-center justify-between opacity-25 sm:top-8 sm:opacity-35"
        >
          {CLUB_LOGOS.map((logo, index) => (
            <Image
              alt=""
              className={`h-10 w-10 object-contain sm:h-14 sm:w-14 lg:h-16 lg:w-16 ${
                index % 2 === 0 ? "translate-y-2" : "-translate-y-2"
              }`}
              height={64}
              key={logo.src}
              src={logo.src}
              width={64}
            />
          ))}
        </div>

        <div className="relative z-10">
          <div className="mb-6 max-w-2xl">
            <SeasonBanner />
          </div>

          <h1 className="max-w-3xl text-5xl font-black tracking-tight sm:text-6xl">
            Fantasy Pingisligan
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-sky-100/75">
            Build a fantasy table tennis squad, track Pingisligan results, and score
            points from real performances to compete on the global leaderboard.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              className="rounded-md bg-sky-100 px-5 py-3 text-center text-sm font-bold text-sky-950 transition hover:bg-white"
              href="/signup"
            >
              Create account
            </Link>
            <Link
              className="rounded-md border border-white/20 bg-white/5 px-5 py-3 text-center text-sm font-bold text-sky-50 transition hover:border-white/60 hover:bg-white/10"
              href="/login"
            >
              Log in
            </Link>
          </div>
        </div>

        <div className="relative z-10 grid gap-4 sm:grid-cols-2">
          <div className="table-panel rounded-lg border p-5">
            <h2 className="font-bold">Build your squad</h2>
            <p className="mt-2 text-sm leading-6 text-sky-100/65">
              Pick six Pingisligan players while staying inside your fantasy
              budget.
            </p>
          </div>

          <div className="table-panel rounded-lg border p-5">
            <h2 className="font-bold">Set your lineup</h2>
            <p className="mt-2 text-sm leading-6 text-sky-100/65">
              Choose four main players, two bench players, and name your team
              captain.
            </p>
          </div>

          <div className="table-panel rounded-lg border p-5">
            <h2 className="font-bold">Follow the season</h2>
            <p className="mt-2 text-sm leading-6 text-sky-100/65">
              Track real Pingisligan results and watch your fantasy picks come
              alive.
            </p>
          </div>

          <div className="table-panel rounded-lg border p-5">
            <h2 className="font-bold">Compete for bragging rights</h2>
            <p className="mt-2 text-sm leading-6 text-sky-100/65">
              Challenge friends, compare squads, and chase the top of the
              table.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

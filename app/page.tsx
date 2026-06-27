import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default function Home() {
  return <HomeContent />;
}

async function HomeContent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-white/10">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link className="font-bold text-emerald-300" href="/">
            Fantasy Pingisligan
          </Link>
          <div className="flex items-center gap-3">
            {user ? (
              <Link
                className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
                href="/dashboard"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  className="rounded-md px-3 py-2 text-sm font-semibold text-zinc-300 transition hover:text-white"
                  href="/login"
                >
                  Log in
                </Link>
                <Link
                  className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
                  href="/signup"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-73px)] max-w-6xl content-center gap-10 px-6 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <div className="mb-6 inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-200">
            Account foundation ready
          </div>

          <h1 className="max-w-3xl text-5xl font-black tracking-tight sm:text-6xl">
            Fantasy Pingisligan
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
            Build a fantasy table tennis squad, track Pingisligan results, score
            points from real performances, and compete in private leagues.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              className="rounded-md bg-emerald-400 px-5 py-3 text-center text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
              href={user ? "/dashboard" : "/signup"}
            >
              {user ? "Open dashboard" : "Create account"}
            </Link>
            <Link
              className="rounded-md border border-white/15 px-5 py-3 text-center text-sm font-bold text-zinc-100 transition hover:border-emerald-300 hover:text-emerald-200"
              href="/login"
            >
              Log in
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-bold">Accounts</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Supabase authentication with signup, login, email confirmation,
              and protected routes.
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-bold">Player pool</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Clubs and players live in Supabase, ready for prices, squads and
              scoring.
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-bold">Fantasy teams</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              A starter schema models teams, squad picks, leagues and
              memberships.
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-bold">Results import</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Profixio scraping should run server-side later, not in browser
              components.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

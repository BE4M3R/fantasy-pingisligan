import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicFooter } from "@/app/public-footer";
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
    <main className="table-tennis-surface flex min-h-screen flex-col text-[var(--pf-text)]">
      <header className="border-b border-white/15 bg-[var(--pf-navy-deep)]/70 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <Link
            aria-label="Fantasy Pingisligan"
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
            className="shrink-0 whitespace-nowrap rounded-md border border-white/25 bg-white/5 px-3 py-2 text-sm font-bold text-[var(--pf-text)] transition hover:border-white/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy-deep)] sm:px-4"
            href="/login"
          >
            Log in
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid w-full max-w-6xl flex-1 content-center gap-x-10 gap-y-8 overflow-hidden px-5 py-8 sm:px-6 sm:py-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <h1 className="max-w-3xl text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
            Build your Pingisligan{" "}
            <span className="text-[var(--pf-logo-gold)]">Fantasy team</span>
          </h1>

          <div className="mt-8">
            <Link
              className="block w-full rounded-lg bg-[var(--pf-logo-gold)] px-6 py-4 text-center text-base font-black text-[var(--pf-navy-deep)] shadow-lg shadow-[var(--pf-navy-deep)]/30 ring-2 ring-[var(--pf-logo-gold-ring)]/80 transition hover:bg-[var(--pf-logo-gold-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--pf-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy-deep)] sm:inline-block sm:w-auto"
              href="/signup"
            >
              Get started
            </Link>
          </div>

          <div className="mt-4 flex flex-col items-center">
            <p className="text-xs font-medium tracking-wide text-[var(--pf-text-muted)]">
              Collaboration with
            </p>
            <a
              aria-label="Visit Svenska Bordtennisförbundet"
              className="mt-2 rounded-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-text)]"
              href="https://sbtf.se/"
              rel="noreferrer"
              target="_blank"
            >
              <Image
                alt="Svenska Bordtennisförbundet"
                className="h-auto w-[100px] brightness-0 invert"
                height={596}
                src="/branding/sbtf-logo.webp"
                width={596}
              />
            </a>
          </div>

        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="table-panel grid grid-cols-[minmax(0,1fr)_minmax(8rem,0.9fr)] items-center gap-4 overflow-hidden rounded-lg border p-5 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div>
              <h2 className="text-base font-semibold text-[var(--pf-text)] sm:text-lg">Build your squad</h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--pf-text-muted)]">
                Pick your favourites from across Pingisligan.
              </p>
            </div>
            <Image
              alt="Example fantasy squad on a table tennis court"
              className="h-auto w-full rounded-md border border-white/15 shadow-lg shadow-[var(--pf-navy-deep)]/35"
              height={272}
              priority
              sizes="(max-width: 640px) 42vw, 176px"
              src="/features/build-squad-start-page.png"
              width={411}
            />
          </div>

          <div className="table-panel grid min-h-28 grid-cols-[minmax(0,1fr)_minmax(8rem,0.9fr)] items-center gap-4 overflow-hidden rounded-lg border p-5 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div>
              <h2 className="text-base font-semibold text-[var(--pf-text)] sm:text-lg">
                Compete for bragging rights
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--pf-text-muted)]">
                Challenge friends and climb the league table.
              </p>
            </div>
            <Image
              alt="Fantasy league table"
              className="h-auto w-full rounded-md border border-white/15 shadow-lg shadow-[var(--pf-navy-deep)]/35"
              height={365}
              sizes="(max-width: 640px) 42vw, 176px"
              src="/features/league-start-page.png"
              width={395}
            />
          </div>
        </div>

      </section>

      <PublicFooter />
    </main>
  );
}

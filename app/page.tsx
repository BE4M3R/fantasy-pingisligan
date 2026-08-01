import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CLUB_LOGOS } from "@/app/dashboard/club-logos";
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
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <Link
            aria-label="Fantasy Pingisligan"
            className="flex min-w-0 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100"
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
            className="shrink-0 whitespace-nowrap rounded-md border border-white/25 bg-white/5 px-3 py-2 text-sm font-bold text-sky-50 transition hover:border-white/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:ring-offset-2 focus-visible:ring-offset-sky-950 sm:px-4"
            href="/login"
          >
            Log in
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-73px)] max-w-6xl content-center gap-x-10 gap-y-8 overflow-hidden px-5 py-8 sm:min-h-[calc(100vh-85px)] sm:px-6 sm:py-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div
          aria-hidden="true"
          className="pointer-events-none grid grid-cols-7 items-center gap-2 px-1 opacity-70 sm:gap-5 sm:px-8 sm:opacity-75 lg:col-span-2 lg:px-16"
        >
          {CLUB_LOGOS.map((logo) => (
            <Image
              alt=""
              className="mx-auto h-8 w-8 object-contain sm:h-12 sm:w-12 lg:h-14 lg:w-14"
              height={64}
              key={logo.src}
              src={logo.src}
              width={64}
            />
          ))}
        </div>

        <div>
          <h1 className="max-w-3xl text-5xl font-black tracking-tight sm:text-6xl">
            Build your Pingisligan dream team
          </h1>

          <div className="mt-8">
            <Link
              className="block w-full rounded-lg bg-[#fbc025] px-6 py-4 text-center text-base font-black text-sky-950 shadow-lg shadow-sky-950/30 ring-2 ring-[#ffe49a]/80 transition hover:bg-[#ffd04a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-sky-950 sm:inline-block sm:w-auto"
              href="/signup"
            >
              Get started
            </Link>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="table-panel grid grid-cols-[minmax(0,1fr)_minmax(8rem,0.9fr)] items-center gap-4 overflow-hidden rounded-lg border p-5 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <h2 className="text-xl font-black sm:text-2xl">Build your squad</h2>
            <Image
              alt="Example fantasy squad on a table tennis court"
              className="h-auto w-full rounded-md border border-white/15 shadow-lg shadow-sky-950/35"
              height={443}
              priority
              sizes="(max-width: 640px) 42vw, 176px"
              src="/features/squad.jpg"
              width={365}
            />
          </div>

          <div className="table-panel grid min-h-28 grid-cols-[minmax(0,1fr)_minmax(8rem,0.9fr)] items-center gap-4 overflow-hidden rounded-lg border p-5 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <h2 className="text-lg font-black">Follow the season</h2>
            <Image
              alt="Round-by-round fantasy points overview"
              className="h-auto w-full rounded-md border border-white/15 shadow-lg shadow-sky-950/35"
              height={1186}
              sizes="(max-width: 640px) 42vw, 176px"
              src="/features/progress.png"
              width={1326}
            />
          </div>

          <div className="table-panel grid min-h-28 grid-cols-[minmax(0,1fr)_minmax(8rem,0.9fr)] items-center gap-4 overflow-hidden rounded-lg border p-5 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <h2 className="text-lg font-black">Compete for bragging rights</h2>
            <Image
              alt="Fantasy league leaderboard"
              className="h-auto w-full rounded-md border border-white/15 shadow-lg shadow-sky-950/35"
              height={1111}
              sizes="(max-width: 640px) 42vw, 176px"
              src="/features/brag-to-friends.png"
              width={1415}
            />
          </div>
        </div>

        <div className="flex justify-center pt-2 lg:col-span-2">
          <Link
            className="rounded-md border border-white/25 bg-white/5 px-5 py-3 text-sm font-bold text-sky-50 transition hover:border-white/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:ring-offset-2 focus-visible:ring-offset-sky-950"
            href="/rules"
          >
            Read the rules
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900 text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-6 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-200 shadow-lg shadow-emerald-950/40">
          Coming soon
        </div>

        <h1 className="max-w-4xl text-5xl font-black tracking-tight sm:text-7xl">
          Fantasy{" "}
          <span className="bg-gradient-to-r from-emerald-300 to-lime-300 bg-clip-text text-transparent">
            Pingisligan
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
          Build your dream table tennis squad, outsmart your friends, and follow
          the Swedish Pingisligan season with fantasy points, player prices and
          league bragging rights.
        </p>

        <div className="mt-10 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
            <div className="text-3xl">🏓</div>
            <h2 className="mt-3 font-bold">Pick players</h2>
            <p className="mt-2 text-sm text-slate-400">
              Choose your squad before the deadline.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
            <div className="text-3xl">📈</div>
            <h2 className="mt-3 font-bold">Score points</h2>
            <p className="mt-2 text-sm text-slate-400">
              Follow results, form and fantasy rankings.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
            <div className="text-3xl">👑</div>
            <h2 className="mt-3 font-bold">Beat friends</h2>
            <p className="mt-2 text-sm text-slate-400">
              Create private leagues and chase glory.
            </p>
          </div>
        </div>

        <div className="mt-10 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-6 py-4 text-sm text-emerald-100">
          First serve is not ready yet — but the warm-up has started.
        </div>

        <p className="mt-8 text-xs uppercase tracking-[0.35em] text-slate-500">
          Fantasy table tennis · Sweden · Pingisligan
        </p>
      </section>
    </main>
  );
}
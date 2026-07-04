import Link from "next/link";
import { redirect } from "next/navigation";
import { sendPasswordReset, signIn } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  const { message } = await searchParams;

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <div className="table-panel rounded-lg border p-6">
          <Link className="text-sm font-semibold text-sky-200" href="/">
            Fantasy Pingisligan
          </Link>

          <h1 className="mt-8 text-3xl font-bold tracking-tight">Log in</h1>
          <p className="mt-3 text-sm leading-6 text-sky-100/70">
            Pick your squad, follow matchdays, and compete on the leaderboard.
          </p>

          {message ? (
            <div className="mt-6 rounded-md border border-sky-200/30 bg-sky-200/10 px-4 py-3 text-sm text-sky-100">
              {message}
            </div>
          ) : null}

          <form action={signIn} className="mt-8 space-y-5">
            <label className="block text-sm font-medium text-sky-100">
              Email
              <input
                className="mt-2 w-full rounded-md border border-white/15 bg-sky-950/70 px-3 py-3 text-white outline-none transition placeholder:text-sky-100/30 focus:border-sky-100"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </label>

            <label className="block text-sm font-medium text-sky-100">
              Password
              <input
                className="mt-2 w-full rounded-md border border-white/15 bg-sky-950/70 px-3 py-3 text-white outline-none transition placeholder:text-sky-100/30 focus:border-sky-100"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>

            <button className="w-full rounded-md bg-sky-100 px-4 py-3 text-sm font-bold text-sky-950 transition hover:bg-white">
              Log in
            </button>
          </form>

          <p className="mt-6 text-sm text-sky-100/60">
            No account yet?{" "}
            <Link className="font-semibold text-sky-100" href="/signup">
              Create one
            </Link>
          </p>

          <form
            action={sendPasswordReset}
            className="mt-6 border-t border-white/10 pt-6"
          >
            <label className="block text-sm font-medium text-sky-100">
              Forgot password?
              <input
                autoComplete="email"
                className="mt-2 w-full rounded-md border border-white/15 bg-sky-950/70 px-3 py-3 text-white outline-none transition placeholder:text-sky-100/30 focus:border-sky-100"
                name="email"
                placeholder="Email"
                required
                type="email"
              />
            </label>

            <button className="mt-3 w-full rounded-md border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-sky-50 transition hover:border-white/60 hover:bg-white/10">
              Send reset link
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

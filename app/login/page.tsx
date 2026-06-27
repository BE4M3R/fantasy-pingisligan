import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/app/auth/actions";
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
    <main className="min-h-screen bg-zinc-950 text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <Link className="text-sm font-semibold text-emerald-300" href="/">
          Fantasy Pingisligan
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-tight">Log in</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Pick your squad, follow matchdays, and compete in your leagues.
        </p>

        {message ? (
          <div className="mt-6 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
            {message}
          </div>
        ) : null}

        <form action={signIn} className="mt-8 space-y-5">
          <label className="block text-sm font-medium text-zinc-200">
            Email
            <input
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-3 text-white outline-none transition focus:border-emerald-400"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>

          <label className="block text-sm font-medium text-zinc-200">
            Password
            <input
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-3 text-white outline-none transition focus:border-emerald-400"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          <button className="w-full rounded-md bg-emerald-400 px-4 py-3 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300">
            Log in
          </button>
        </form>

        <p className="mt-6 text-sm text-zinc-400">
          No account yet?{" "}
          <Link className="font-semibold text-emerald-300" href="/signup">
            Create one
          </Link>
        </p>
      </section>
    </main>
  );
}

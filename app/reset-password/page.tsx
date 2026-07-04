import Link from "next/link";
import { redirect } from "next/navigation";
import { updatePassword } from "@/app/auth/actions";
import { SeasonBanner } from "@/app/season-banner";
import { createClient } from "@/lib/supabase/server";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?message=${encodeURIComponent(
        "Open the password reset link from your email before setting a new password.",
      )}`,
    );
  }

  const { message } = await searchParams;

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-4">
          <SeasonBanner />
        </div>

        <div className="table-panel rounded-lg border p-6">
          <Link className="text-sm font-semibold text-sky-200" href="/">
            Fantasy Pingisligan
          </Link>

          <h1 className="mt-8 text-3xl font-bold tracking-tight">
            Reset password
          </h1>
          <p className="mt-3 text-sm leading-6 text-sky-100/70">
            Choose a new password for your account.
          </p>

          {message ? (
            <div className="mt-6 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              {message}
            </div>
          ) : null}

          <form action={updatePassword} className="mt-8 space-y-5">
            <label className="block text-sm font-medium text-sky-100">
              New password
              <input
                autoComplete="new-password"
                className="mt-2 w-full rounded-md border border-white/15 bg-sky-950/70 px-3 py-3 text-white outline-none transition placeholder:text-sky-100/30 focus:border-sky-100"
                minLength={6}
                name="password"
                required
                type="password"
              />
            </label>

            <button className="w-full rounded-md bg-sky-100 px-4 py-3 text-sm font-bold text-sky-950 transition hover:bg-white">
              Save new password
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

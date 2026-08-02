import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/app/auth/actions";
import PasswordResetDialog from "@/app/login/password-reset-dialog";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (claims?.sub) {
    redirect("/dashboard/overview");
  }

  const { message } = await searchParams;

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <div className="table-panel rounded-xl border p-6 sm:p-8">
          <Link
            aria-label="Fantasy Pingisligan home"
            className="mx-auto flex w-fit flex-col items-center gap-3"
            href="/"
          >
            <Image
              alt=""
              className="h-auto w-20"
              height={219}
              priority
              src="/branding/pingisligan-fantasy-mark-transparent-v2.png"
              width={220}
            />
            <Image
              alt="Fantasy Pingisligan"
              className="h-auto w-56 max-w-full"
              height={87}
              priority
              src="/branding/pingisligan-fantasy-wordmark-transparent-v2.png"
              width={381}
            />
          </Link>

          <h1 className="mt-8 text-3xl font-bold tracking-tight text-[var(--pf-text)]">
            Log in
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--pf-text-muted)]">
            Pick your squad, follow matchdays, and compete on the leaderboard.
          </p>

          {message ? (
            <div className="mt-6 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] px-4 py-3 text-sm text-[var(--pf-text)]">
              {message}
            </div>
          ) : null}

          <form
            action={signIn}
            className="mt-8 space-y-5"
            suppressHydrationWarning
          >
            <label className="block text-sm font-medium text-[var(--pf-text)]">
              Email
              <input
                className="mt-2 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 text-[var(--pf-text)] outline-none transition placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[rgb(var(--pf-brand-blue-rgb)/0.25)]"
                name="email"
                suppressHydrationWarning
                type="email"
                autoComplete="email"
                required
              />
            </label>

            <label className="block text-sm font-medium text-[var(--pf-text)]">
              Password
              <input
                className="mt-2 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 text-[var(--pf-text)] outline-none transition placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[rgb(var(--pf-brand-blue-rgb)/0.25)]"
                name="password"
                suppressHydrationWarning
                type="password"
                autoComplete="current-password"
                required
              />
            </label>

            <button className="w-full rounded-md bg-[var(--pf-logo-gold)] px-4 py-3 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-logo-gold-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pf-logo-gold-ring)]">
              Log in
            </button>
          </form>

          <p className="mt-6 text-sm text-[var(--pf-text-muted)]">
            No account yet?{" "}
            <Link
              className="font-semibold text-[var(--pf-logo-gold)] transition hover:text-[var(--pf-logo-gold-hover)]"
              href="/signup"
            >
              Create one
            </Link>
          </p>
          <PasswordResetDialog />
        </div>
      </section>
    </main>
  );
}

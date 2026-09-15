import Image from "next/image";
import Link from "next/link";

export default function ConfirmationErrorPage() {
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
            Email confirmation failed
          </h1>
          <div
            className="mt-6 rounded-md border border-[var(--pf-coral)] bg-[var(--pf-coral-soft)] px-4 py-3 text-sm text-[var(--pf-coral-text)]"
            role="alert"
          >
            This confirmation link is invalid or has expired.
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--pf-text-muted)]">
            You can log in if your email is already confirmed, or create an
            account to start again.
          </p>

          <div className="mt-8 space-y-3">
            <Link
              className="block w-full rounded-md bg-[var(--pf-logo-gold)] px-4 py-3 text-center text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-logo-gold-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pf-logo-gold-ring)]"
              href="/login"
            >
              Go to login
            </Link>
            <Link
              className="block w-full rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-4 py-3 text-center text-sm font-semibold text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)]"
              href="/signup"
            >
              Create an account
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

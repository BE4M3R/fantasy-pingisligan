import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordResetForm } from "@/app/forgot-password/password-reset-form";
import { createClient } from "@/lib/supabase/server";

export default async function ForgotPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims?.sub) {
    redirect("/dashboard/overview");
  }

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

          <div className="mt-8">
            <PasswordResetForm />
          </div>

          <p className="mt-6 text-sm text-[var(--pf-text-muted)]">
            Remembered your password?{" "}
            <Link
              className="font-semibold text-[var(--pf-logo-gold)] transition hover:text-[var(--pf-logo-gold-hover)]"
              href="/login"
            >
              Return to login
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

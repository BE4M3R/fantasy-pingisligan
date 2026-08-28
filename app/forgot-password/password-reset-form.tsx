"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type ResetStep = "email" | "verify";

export function PasswordResetForm() {
  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
    );

    setIsSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setToken("");
    setStep("verify");
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const passwordConfirmation = String(
      formData.get("password_confirmation") ?? "",
    );

    if (password !== passwordConfirmation) {
      setError("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: "recovery",
    });

    if (verifyError) {
      setError("The verification code is invalid or has expired.");
      setIsSubmitting(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setIsSubmitting(false);
      return;
    }

    await supabase.auth.signOut();
    window.location.replace(
      `/login?message=${encodeURIComponent(
        "Password updated. Log in with your new password.",
      )}`,
    );
  }

  return (
    <>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--pf-logo-gold)]">
        Password recovery
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--pf-text)]">
        {step === "email" ? "Reset your password" : "Check your email"}
      </h1>

      {step === "email" ? (
        <form className="mt-6" key="email" onSubmit={requestCode}>
          <p className="text-sm leading-6 text-[var(--pf-text-muted)]">
            Enter the email address connected to your account. We will send
            you a verification code.
          </p>

          <label className="mt-5 block text-sm font-medium text-[var(--pf-text)]">
            Email
            <input
              autoComplete="email"
              autoFocus
              className="mt-2 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 text-[var(--pf-text)] outline-none transition placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[rgb(var(--pf-brand-blue-rgb)/0.25)]"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>

          {error ? (
            <p
              className="mt-4 rounded-md border border-[var(--pf-coral)] bg-[var(--pf-coral-soft)] px-4 py-3 text-sm text-[var(--pf-coral-text)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            className="mt-6 w-full rounded-md bg-[var(--pf-logo-gold)] px-4 py-3 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-logo-gold-hover)] disabled:cursor-wait disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Sending code…" : "Send verification code"}
          </button>
        </form>
      ) : (
        <form className="mt-6 space-y-5" key="verify" onSubmit={verifyCode}>
          <p className="text-sm leading-6 text-[var(--pf-text-muted)]">
            Enter the code sent to{" "}
            <strong className="text-[var(--pf-text)]">{email}</strong> and
            choose your new password.
          </p>

          <label className="block text-sm font-medium text-[var(--pf-text)]">
            Verification code
            <input
              autoComplete="one-time-code"
              className="mt-2 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 tracking-[0.2em] text-[var(--pf-text)] outline-none transition placeholder:tracking-normal placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-brand-blue)] focus:placeholder:text-transparent focus:ring-2 focus:ring-[rgb(var(--pf-brand-blue-rgb)/0.25)]"
              inputMode="numeric"
              minLength={6}
              onChange={(event) =>
                setToken(event.target.value.replace(/\D/g, "").slice(0, 10))
              }
              pattern="[0-9]{6,10}"
              placeholder="Enter verification code"
              required
              type="text"
              value={token}
            />
          </label>

          <label className="block text-sm font-medium text-[var(--pf-text)]">
            New password
            <input
              autoComplete="new-password"
              className="mt-2 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 text-[var(--pf-text)] outline-none transition focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[rgb(var(--pf-brand-blue-rgb)/0.25)]"
              minLength={6}
              name="password"
              required
              type="password"
            />
          </label>

          <label className="block text-sm font-medium text-[var(--pf-text)]">
            Confirm new password
            <input
              autoComplete="new-password"
              className="mt-2 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 text-[var(--pf-text)] outline-none transition focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[rgb(var(--pf-brand-blue-rgb)/0.25)]"
              minLength={6}
              name="password_confirmation"
              required
              type="password"
            />
          </label>

          {error ? (
            <p
              className="rounded-md border border-[var(--pf-coral)] bg-[var(--pf-coral-soft)] px-4 py-3 text-sm text-[var(--pf-coral-text)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            className="w-full rounded-md bg-[var(--pf-logo-gold)] px-4 py-3 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-logo-gold-hover)] disabled:cursor-wait disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Updating password…" : "Update password"}
          </button>

          <button
            className="w-full text-sm font-semibold text-[var(--pf-text-muted)] transition hover:text-[var(--pf-text)]"
            disabled={isSubmitting}
            onClick={() => {
              setError("");
              setToken("");
              setStep("email");
            }}
            type="button"
          >
            Use a different email
          </button>
        </form>
      )}
    </>
  );
}

"use client";

import { FormEvent, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type ResetStep = "email" | "verify";

export default function PasswordResetDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resetDialog() {
    setStep("email");
    setEmail("");
    setError("");
    setIsSubmitting(false);
  }

  function closeDialog() {
    if (!isSubmitting) {
      dialogRef.current?.close();
    }
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
    );

    setIsSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setStep("verify");
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const formData = new FormData(event.currentTarget);
    const token = String(formData.get("token") ?? "").replace(/\s/g, "");
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
      email,
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
    setSuccess("Password updated. You can now log in with your new password.");
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        className="mt-4 text-left text-sm font-semibold text-[var(--pf-logo-gold)] transition hover:text-[var(--pf-logo-gold-hover)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pf-logo-gold-ring)]"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        Forgot your password?
      </button>

      {success ? (
        <div
          className="mt-6 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] px-4 py-3 text-sm text-[var(--pf-text)]"
          role="status"
        >
          {success}
        </div>
      ) : null}

      <dialog
        aria-labelledby="password-reset-title"
        className="m-auto w-[calc(100%-3rem)] max-w-md rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-0 text-[var(--pf-text)] shadow-2xl backdrop:bg-[var(--pf-navy-deep)]/75"
        onClick={(event) => {
          if (event.target === dialogRef.current) closeDialog();
        }}
        onClose={resetDialog}
        ref={dialogRef}
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--pf-logo-gold)]">
                Password recovery
              </p>
              <h2
                className="mt-2 text-2xl font-bold tracking-tight"
                id="password-reset-title"
              >
                {step === "email" ? "Reset your password" : "Check your email"}
              </h2>
            </div>
            <button
              aria-label="Close password reset"
              className="-mr-2 -mt-2 rounded-md p-2 text-2xl leading-none text-[var(--pf-text-muted)] transition hover:bg-[var(--pf-navy-elevated)] hover:text-[var(--pf-text)]"
              disabled={isSubmitting}
              onClick={closeDialog}
              type="button"
            >
              ×
            </button>
          </div>

          {step === "email" ? (
            <form className="mt-6" onSubmit={requestCode}>
              <p className="text-sm leading-6 text-[var(--pf-text-muted)]">
                Enter the email address connected to your account. A verification
                code will be sent to you through Supabase Auth.
              </p>
              <label className="mt-5 block text-sm font-medium">
                Email
                <input
                  autoComplete="email"
                  autoFocus
                  className="mt-2 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 outline-none transition placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[rgb(var(--pf-brand-blue-rgb)/0.25)]"
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
            <form className="mt-6 space-y-5" onSubmit={verifyCode}>
              <p className="text-sm leading-6 text-[var(--pf-text-muted)]">
                Enter the code sent to <strong className="text-[var(--pf-text)]">{email}</strong>
                {" "}and choose your new password.
              </p>

              <label className="block text-sm font-medium">
                Verification code
                <input
                  autoComplete="one-time-code"
                  autoFocus
                  className="mt-2 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 tracking-[0.2em] outline-none transition placeholder:tracking-normal placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[rgb(var(--pf-brand-blue-rgb)/0.25)]"
                  inputMode="numeric"
                  name="token"
                  placeholder="Enter the code"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                New password
                <input
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 outline-none transition focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[rgb(var(--pf-brand-blue-rgb)/0.25)]"
                  minLength={6}
                  name="password"
                  required
                  type="password"
                />
              </label>

              <label className="block text-sm font-medium">
                Confirm new password
                <input
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 outline-none transition focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[rgb(var(--pf-brand-blue-rgb)/0.25)]"
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
                {isSubmitting ? "Updating password…" : "Verify and update password"}
              </button>

              <button
                className="w-full text-sm font-semibold text-[var(--pf-text-muted)] transition hover:text-[var(--pf-text)]"
                disabled={isSubmitting}
                onClick={() => {
                  setError("");
                  setStep("email");
                }}
                type="button"
              >
                Use a different email
              </button>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}

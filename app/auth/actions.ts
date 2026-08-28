"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const DEVELOPER_SIGNUP_CODE = "pingisligan-dev";

function getSiteUrl() {
  const configuredSiteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_VERCEL_URL?.trim();

  if (!configuredSiteUrl) return null;

  const siteUrl = /^https?:\/\//i.test(configuredSiteUrl)
    ? configuredSiteUrl
    : `https://${configuredSiteUrl}`;

  try {
    const url = new URL(siteUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithMessage(path: string, message: string) {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}message=${encodeURIComponent(message)}`);
}

function getSafeDashboardPath(value: string) {
  return value === "/dashboard" || value.startsWith("/dashboard/")
    ? value
    : "/dashboard/overview";
}

export async function signIn(formData: FormData) {
  const email = getString(formData, "email");
  const password = getString(formData, "password");
  const nextPath = getSafeDashboardPath(getString(formData, "next"));

  if (!email || !password) {
    redirectWithMessage(
      `/login?next=${encodeURIComponent(nextPath)}`,
      "Email and password are required.",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirectWithMessage(
      `/login?next=${encodeURIComponent(nextPath)}`,
      error.message,
    );
  }

  redirect(nextPath);
}

export async function sendPasswordReset(formData: FormData) {
  const email = getString(formData, "email");
  const siteUrl = getSiteUrl();

  if (!email) {
    redirectWithMessage("/login", "Email is required to reset your password.");
  }

  if (!siteUrl) {
    redirectWithMessage(
      "/login",
      "Password reset is temporarily unavailable. Please try again later.",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/reset-password`,
  });

  if (error) {
    redirectWithMessage("/login", error.message);
  }

  redirectWithMessage(
    "/login",
    "If an account exists for that email, a password reset link has been sent.",
  );
}

export async function signUp(formData: FormData) {
  const email = getString(formData, "email");
  const password = getString(formData, "password");
  const developerCode = getString(formData, "developer_code");
  const siteUrl = getSiteUrl();

  if (!email || !password || !developerCode) {
    redirectWithMessage(
      "/signup",
      "Email, password and developer code are required.",
    );
  }

  if (developerCode !== DEVELOPER_SIGNUP_CODE) {
    redirectWithMessage("/signup", "The developer code is not correct.");
  }

  if (!siteUrl) {
    redirectWithMessage(
      "/signup",
      "Account confirmation is temporarily unavailable. Please try again later.",
    );
  }

  const supabase = await createClient();
  const { data: emailIsRegistered, error: emailCheckError } =
    await supabase.rpc("email_is_registered", { candidate_email: email });

  if (emailCheckError) {
    redirectWithMessage("/signup", emailCheckError.message);
  }

  if (emailIsRegistered) {
    redirectWithMessage(
      "/signup",
      "That email is already in use. Log in or reset your password instead.",
    );
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (error) {
    redirectWithMessage("/signup", error.message);
  }

  redirectWithMessage(
    "/login",
    "Check your email to confirm your account, then sign in.",
  );
}

export async function updatePassword(formData: FormData) {
  const password = getString(formData, "password");

  if (!password) {
    redirectWithMessage("/reset-password", "Password is required.");
  }

  if (password.length < 6) {
    redirectWithMessage(
      "/reset-password",
      "Password must be at least 6 characters.",
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) {
    redirectWithMessage(
      "/login",
      "Open the password reset link from your email before setting a new password.",
    );
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirectWithMessage("/reset-password", error.message);
  }

  await supabase.auth.signOut();
  redirectWithMessage("/login", "Password updated. Sign in with your new password.");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithMessage(path: string, message: string) {
  redirect(`${path}?message=${encodeURIComponent(message)}`);
}

export async function signIn(formData: FormData) {
  const email = getString(formData, "email");
  const password = getString(formData, "password");

  if (!email || !password) {
    redirectWithMessage("/login", "Email and password are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirectWithMessage("/login", error.message);
  }

  redirect("/dashboard");
}

export async function signUp(formData: FormData) {
  const email = getString(formData, "email");
  const password = getString(formData, "password");
  const displayName = getString(formData, "display_name");

  if (!email || !password || !displayName) {
    redirectWithMessage("/signup", "Name, email and password are required.");
  }

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data: {
        display_name: displayName,
      },
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

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

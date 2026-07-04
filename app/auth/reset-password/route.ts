import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL(
        `/login?message=${encodeURIComponent(
          "Password reset link is missing a login code. Try sending a new reset link.",
        )}`,
        requestUrl.origin,
      ),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/login?message=${encodeURIComponent(error.message)}`,
        requestUrl.origin,
      ),
    );
  }

  return NextResponse.redirect(new URL("/reset-password", requestUrl.origin));
}

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const CONFIRMATION_ERROR_PATH = "/auth/confirmation-error";

function getSuccessPath(requestUrl: URL) {
  const type = requestUrl.searchParams.get("type");

  if (type === "recovery") return "/reset-password";

  const next = requestUrl.searchParams.get("next");
  return next === "/dashboard" || next?.startsWith("/dashboard/")
    ? next
    : "/dashboard/overview";
}

function getErrorUrl(requestUrl: URL, errorPath: string) {
  const errorUrl = new URL(errorPath, requestUrl.origin);

  // An explicit safe fragment prevents browsers from carrying Supabase's
  // original #error=... fragment across the redirect.
  errorUrl.hash = "auth-error";
  return errorUrl;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const type = requestUrl.searchParams.get("type");
  const errorPath =
    type === "recovery"
      ? `/login?message=${encodeURIComponent(
          "This password reset link is invalid or has expired.",
        )}`
      : CONFIRMATION_ERROR_PATH;

  if (!code || requestUrl.searchParams.has("error")) {
    return NextResponse.redirect(getErrorUrl(requestUrl, errorPath));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(getErrorUrl(requestUrl, errorPath));
  }

  return NextResponse.redirect(
    new URL(getSuccessPath(requestUrl), requestUrl.origin),
  );
}

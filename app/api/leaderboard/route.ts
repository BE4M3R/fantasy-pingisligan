import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGlobalLeaderboard } from "@/lib/leaderboard";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
  }
  const result = await getGlobalLeaderboard();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 503 });
  return NextResponse.json({ rows: result.data.slice(offset, offset + 50), total: result.data.length }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

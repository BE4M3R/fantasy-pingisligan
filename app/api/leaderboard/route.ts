import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGlobalLeaderboard } from "@/lib/leaderboard";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const offset = Number(params.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
  }
  const search = params.get("search")?.trim() ?? "";
  if (search.length > 80) {
    return NextResponse.json({ error: "Search is too long" }, { status: 400 });
  }
  const result = await getGlobalLeaderboard();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 503 });
  const matching = search
    ? result.data.filter((row) => row.team_name.toLowerCase().includes(search.toLowerCase()))
    : result.data;
  return NextResponse.json({ rows: matching.slice(offset, offset + 50), total: matching.length }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

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
  if (search) {
    const { data: matches, error } = await supabase.rpc("search_global_leaderboard", {
      p_search: search,
      p_offset: offset,
      p_limit: 50,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 503 });
    const rows = (matches ?? []) as {
      user_id: string;
      team_name: string;
      total_points: number | string;
      rank: number;
      total_matches: number | string;
    }[];
    return NextResponse.json({
      rows: rows.map((row) => ({
        user_id: row.user_id,
        team_name: row.team_name,
        total_points: row.total_points,
        rank: row.rank,
      })),
      total: Number(rows[0]?.total_matches ?? 0),
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const result = await getGlobalLeaderboard();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 503 });
  return NextResponse.json({ rows: result.data.slice(offset, offset + 50), total: result.data.length }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

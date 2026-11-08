import { competitionsEnabled } from "@/lib/competition-publication";
import { NextResponse } from "next/server";
import { getCompetitionStandings } from "@/lib/competition-data";
import { isGameweekId } from "@/lib/competitions";
import { createPublicClient } from "@/lib/supabase/public";

// Public, safe projection through the same anonymous RPC as the initial page.
export async function GET(request: Request, { params }: { params: Promise<{ gameweekId: string }> }) {
  if (!await competitionsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  const { gameweekId } = await params;
  const query = new URL(request.url).searchParams;
  const offset = Number(query.get("offset") ?? 0);
  const search = query.get("search")?.trim() ?? "";
  const headers = { "Cache-Control": "no-store" };
  if (!isGameweekId(gameweekId) || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647 || search.length > 80) {
    return NextResponse.json({ error: "Invalid standings request." }, { status: 400, headers });
  }
  const { data: selected, error } = await createPublicClient({ fresh: true }).from("fantasy_gameweeks")
    .select("id").eq("id", gameweekId).eq("weekly_smash_enabled", true).maybeSingle();
  if (error) return NextResponse.json({ error: "Standings are temporarily unavailable." }, { status: 503, headers });
  if (!selected) return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  const standings = await getCompetitionStandings(gameweekId, offset, offset === 0 && !search ? 5 : 25, search);
  return standings ? NextResponse.json(standings, { headers })
    : NextResponse.json({ error: "Standings are temporarily unavailable." }, { status: 503, headers });
}

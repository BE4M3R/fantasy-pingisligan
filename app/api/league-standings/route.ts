import { NextResponse } from "next/server";
import { isGameweekId } from "@/lib/competitions";
import { getLeagueStandings } from "@/lib/league-standings";
import { getClaims } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const { data } = await getClaims();
  const userId = data?.claims.sub;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const view = params.get("view");
  const gameweek = params.get("gameweek");
  if ((view !== "global" && view !== "gameweek") || (view === "gameweek" && (!gameweek || !isGameweekId(gameweek)))) {
    return NextResponse.json({ error: "Invalid standings request." }, { status: 400, headers });
  }
  const standings = await getLeagueStandings(view, userId, gameweek ?? undefined);
  return NextResponse.json(standings, { status: standings.error ? 503 : 200, headers });
}

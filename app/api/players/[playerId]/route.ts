import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlayerStatistics, isPlayerId } from "@/lib/player-statistics-data";

export async function GET(_request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const client = await createClient();
  const { data } = await client.auth.getClaims();
  if (!data?.claims?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { playerId } = await params;
  if (!isPlayerId(playerId)) return NextResponse.json({ error: "Invalid player." }, { status: 400 });
  try {
    const statistics = await getPlayerStatistics(playerId);
    if (!statistics) return NextResponse.json({ error: "Player not found." }, { status: 404 });
    return NextResponse.json(statistics, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load player statistics. Please try again." }, { status: 500 });
  }
}

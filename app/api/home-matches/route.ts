import { NextResponse } from "next/server";
import { getHomeMatches } from "@/lib/home-matches";
import { getClaims } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { data } = await getClaims();
  if (!data?.claims.sub) return NextResponse.json({}, { status: 401 });
  const gameweek = new URL(request.url).searchParams.get("gameweek") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameweek)) {
    return NextResponse.json({}, { status: 400 });
  }
  const result = await getHomeMatches(gameweek);
  return NextResponse.json(result, {
    status: result.error ? 503 : 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}

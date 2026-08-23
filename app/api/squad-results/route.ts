import { NextResponse } from "next/server";
import {
  buildSquadResult,
  type SquadResultRow,
  type SquadSetBreakdownRow,
} from "@/app/dashboard/result-data";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const gameweekId = new URL(request.url).searchParams.get("gameweek");

  if (!gameweekId || !UUID_PATTERN.test(gameweekId)) {
    return NextResponse.json(
      { error: "A valid gameweek is required." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: claimsResult } = await supabase.auth.getClaims();

  if (!claimsResult?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [result, setBreakdown, snapshot] = await Promise.all([
    supabase.rpc("get_my_squad_result", {
      target_gameweek_id: gameweekId,
    }),
    supabase.rpc("get_my_squad_set_breakdown", {
      target_gameweek_id: gameweekId,
    }),
    supabase
      .from("fantasy_team_gameweek_snapshots")
      .select("transfer_penalty_points")
      .eq("fantasy_gameweek_id", gameweekId)
      .maybeSingle(),
  ]);

  if (result.error || setBreakdown.error || snapshot.error) {
    return NextResponse.json(
      { error: "This gameweek result could not be loaded." },
      { status: 500 },
    );
  }

  if (!snapshot.data || !result.data?.length) {
    return NextResponse.json(
      { error: "No squad result exists for this gameweek." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      squad: buildSquadResult(
        result.data as SquadResultRow[],
        (setBreakdown.data ?? []) as SquadSetBreakdownRow[],
      ),
      transferPenalty: Number(snapshot.data.transfer_penalty_points ?? 0),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}

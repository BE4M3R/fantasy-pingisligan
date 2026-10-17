import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

import { createPublicClient } from "@/lib/supabase/public";

export async function GET() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();

  if (!authData?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await createPublicClient()
    .rpc("get_transfer_players");

  if (error) {
    return NextResponse.json({ error: "Could not load players." }, { status: 500 });
  }

  return NextResponse.json({ players: data ?? [] }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

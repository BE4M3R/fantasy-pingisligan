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
    .from("players")
    .select("id, first_name, last_name, birth_year, price, active, clubs(id, name)")
    .eq("active", true)
    .order("price", { ascending: false })
    .order("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ players: data ?? [] }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

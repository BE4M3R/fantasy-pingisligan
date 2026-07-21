import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();

  if (!authData?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("players")
    .select("id, first_name, last_name, birth_year, price, clubs(id, name)")
    .eq("active", true)
    .order("ranking_position", { ascending: true, nullsFirst: false })
    .order("price", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ players: data ?? [] });
}

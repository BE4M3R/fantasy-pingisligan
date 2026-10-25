import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { checked, cleanupFixture, createFixture } from "./fixture.mjs";

test("standings return current profile names through global, search and members-only private RPCs", async (t) => {
  const f = await createFixture({ gameweeks: 0 });
  let leagueId;
  t.after(async () => {
    if (leagueId) checked(await f.admin.from("leagues").delete().eq("id", leagueId), "Remove league");
    await cleanupFixture(f);
  });
  leagueId = checked(await f.user.rpc("create_private_league", { p_name: "Display names" }), "Create league");
  const anon = createClient(f.url, f.anonKey, { auth: { persistSession: false } });
  const denied = await anon.rpc("get_private_league_leaderboard", { p_league_id: leagueId });
  assert.ok(denied.error, "Private standings still require authentication");

  for (const display_name of ["Åsa Andersson", "Updated manager", ""]) {
    checked(await f.user.from("profiles").update({ display_name }).eq("id", f.userId), "Update own profile");
    for (const [rpc, args] of [
      ["get_global_leaderboard", {}],
      ["search_global_leaderboard", { p_search: `Functional ${f.id}` }],
      ["get_private_league_leaderboard", { p_league_id: leagueId }],
    ]) {
      const rows = checked(await f.user.rpc(rpc, args), rpc);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].display_name, display_name);
      assert.equal(rows[0].team_name, `Functional ${f.id}`);
      assert.equal(Number(rows[0].total_points), 0);
      assert.ok(!("email" in rows[0]), "Standings never return account email");
    }
  }
});

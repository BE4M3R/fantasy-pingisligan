import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { checked, cleanupFixture, createFixture } from "./fixture.mjs";

const anonymous = (f) => createClient(f.url, f.anonKey, { auth: { persistSession: false } });
const winners = async (f, client = anonymous(f)) => checked(await client.rpc("get_public_competition_winners"), "Read manual winners");
const choose = (f, teamId, week = f.weeks[0]) => f.admin.from("competition_publication")
  .update({ competition_winner: teamId }).eq("gameweek_id", week.id);

test("Table Editor selects, replaces and clears a winner without ranking or score prerequisites", async () => {
  const f = await createFixture({ gameweeks: 2, competitions: true });
  let rival;
  try {
    assert.deepEqual(await winners(f), []);
    checked(await choose(f, f.teamId), "Choose team without a squad, prize, terms or completed Gameweek");
    assert.deepEqual(await winners(f), [{ gameweek_id: f.weeks[0].id, team_name: `Functional ${f.id}`, points: null }]);
    assert.deepEqual(await winners(f, f.user), await winners(f));
    checked(await f.admin.from("fantasy_team_gameweek_points").insert({ fantasy_team_id: f.teamId,
      fantasy_gameweek_id: f.weeks[0].id, points: 100 }), "Store other team's higher score");
    rival = checked(await f.admin.auth.admin.createUser({ email: `manual-winner-${randomUUID()}@example.invalid`,
      password: f.password, email_confirm: true }), "Create alternative winner").user.id;
    const team = checked(await f.admin.from("fantasy_teams").insert({ user_id: rival, name: "Manually selected team" })
      .select("id").single(), "Create alternative team");
    checked(await f.admin.from("fantasy_team_gameweek_points").insert({ fantasy_team_id: team.id,
      fantasy_gameweek_id: f.weeks[0].id, points: 5 }), "Store lower score");
    checked(await choose(f, team.id), "Replace selected team regardless of ranking");
    assert.deepEqual(await winners(f), [{ gameweek_id: f.weeks[0].id, team_name: "Manually selected team", points: 5 }]);
    checked(await f.admin.from("fantasy_team_gameweek_points").update({ points: 0 })
      .eq("fantasy_team_id", team.id).eq("fantasy_gameweek_id", f.weeks[0].id), "Change score after publication");
    assert.equal((await winners(f))[0].points, 0, "A score correction never clears the operator's choice");
    for (const id of ["global", `gameweek:${f.weeks[0].id}`]) {
      checked(await f.admin.from("competition_publication").update({ enabled: false }).eq("id", id), "Hide competition");
      assert.deepEqual(await winners(f), []);
      checked(await f.admin.from("competition_publication").update({ enabled: true }).eq("id", id), "Restore competition");
      assert.equal((await winners(f))[0].team_name, "Manually selected team");
    }
    checked(await choose(f, null), "Clear winner");
    assert.deepEqual(await winners(f), []);
    checked(await choose(f, team.id), "Reselect winner directly");
    checked(await f.admin.auth.admin.deleteUser(rival), "Delete selected team owner");
    rival = null;
    assert.deepEqual(await winners(f), [], "Deleting the team clears its winner reference");
  } finally {
    if (rival) checked(await f.admin.auth.admin.deleteUser(rival), "Remove alternative winner");
    await cleanupFixture(f);
  }
});

test("manual winners respect future embargoes and editorial permissions, with no automatic confirmation or draw RPCs", async () => {
  const f = await createFixture({ gameweeks: 2, competitions: true });
  try {
    const anon = anonymous(f);
    checked(await choose(f, f.teamId, f.weeks[1]), "Prepare future winner");
    assert.deepEqual(await winners(f), [], "Upcoming Gameweeks remain embargoed");
    for (const client of [anon, f.user]) {
      assert.ok((await client.from("competition_publication").update({ competition_winner: f.teamId })
        .eq("gameweek_id", f.weeks[0].id)).error, "Visitors cannot select winners");
      assert.ok((await client.from("competition_publication").select("competition_winner")).error,
        "The selected private team UUID is not a public editorial field");
      assert.ok(checked(await client.from("competition_publication").select("id, name, enabled, gameweek_id"), "Read public switches").length);
    }
    assert.equal((await choose(f, randomUUID())).error?.code, "23503", "Only an existing Fantasy team can be selected");
    assert.equal((await f.admin.from("competition_publication").update({ competition_winner: f.teamId })
      .eq("id", "global")).error?.code, "23514", "Winner selection belongs on Gameweek rows");
    assert.ok((await f.admin.rpc("confirm_gameweek_competition_winner", {
      p_gameweek_id: f.weeks[0].id, p_expected_team_id: f.teamId, p_allow_draw: true,
    })).error, "The confirmation/draw function has been removed");
    assert.ok((await f.admin.rpc("withdraw_gameweek_competition_winner", { p_gameweek_id: f.weeks[0].id })).error);
    assert.deepEqual(checked(await anon.rpc("get_public_competition_winners", { p_gameweek_id: randomUUID() }), "Unknown round"), []);
  } finally { await cleanupFixture(f); }
});

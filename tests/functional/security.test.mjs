import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  checked, cleanupFixture, createFixture, lock, save, squad,
} from "./fixture.mjs";

async function fixtureFor(t) {
  // The local runner supplies isolated credentials; CI prepares its own clean
  // local stack. createFixture also verifies loopback and an empty database.
  assert.ok(process.env.FUNCTIONAL_TEST_SUPABASE_URL || process.env.CI === "true",
    "Run security regressions through npm run test:functional (disposable stack).");
  const fixture = await createFixture();
  t.after(() => cleanupFixture(fixture));
  const { data, error } = await fixture.user.auth.getClaims();
  assert.equal(error, null, "Verify the ordinary user's session");
  assert.equal(data.claims.role, "authenticated", "Requests must not use the service role");
  return fixture;
}

const selection = (f, captain = 0) => squad([
  f.players[0], f.players[2], f.players[4],
  f.players[6], f.players[1], f.players[3],
], { captain });

async function readBudget(f) {
  return Number(checked(await f.admin.from("fantasy_teams")
    .select("budget").eq("id", f.teamId).single(), "Read fixture budget").budget);
}

async function readSquad(f) {
  return checked(await f.user.from("fantasy_team_players")
    .select("player_id, position, is_captain, lineup_order, created_at")
    .eq("fantasy_team_id", f.teamId).order("lineup_order"), "Read own squad");
}

test("owner creates a 100m team with default or explicit budget, renames it, completes onboarding and selects any starting captain", async (t) => {
  const f = await fixtureFor(t);
  checked(await f.admin.from("fantasy_teams").delete().eq("id", f.teamId), "Remove setup team");
  checked(await f.user.from("fantasy_teams").insert({
    id: f.teamId, user_id: f.userId, name: `Security ${f.id}`,
  }), "Owner creates team with database default");
  assert.equal(await readBudget(f), 100000000);
  checked(await f.admin.from("fantasy_teams").delete().eq("id", f.teamId), "Remove default team");
  checked(await f.user.from("fantasy_teams").insert({
    id: f.teamId, user_id: f.userId, name: `Security ${f.id}`, budget: 100000000,
  }), "Owner creates team with the explicit normal budget used by the app");
  const updatedAt = new Date().toISOString();
  checked(await f.user.from("fantasy_teams").update({
    name: `Renamed ${f.id}`, onboarding_completed: true,
    updated_at: updatedAt,
  }).eq("id", f.teamId), "Owner changes editable fields");
  const team = checked(await f.user.from("fantasy_teams")
    .select("name, onboarding_completed, updated_at").eq("id", f.teamId).single(), "Read updated team");
  assert.equal(team.name, `Renamed ${f.id}`);
  assert.equal(team.onboarding_completed, true);
  assert.equal(new Date(team.updated_at).toISOString(), updatedAt);
  for (const captain of [0, 1, 2, 3]) {
    checked(await save(f, selection(f, captain)), "Owner saves valid starting captain");
    assert.equal((await readSquad(f)).find((p) => p.is_captain)?.player_id,
      selection(f, captain)[captain].player_id);
  }
});

test("anonymous and another authenticated user cannot change the owner's budget or editable team fields", async (t) => {
  const f = await fixtureFor(t);
  const anonymous = createClient(f.url, f.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await anonymous.from("fantasy_teams").update({ budget: 500000000 }).eq("id", f.teamId);
  await anonymous.from("fantasy_teams").update({ name: "Anonymous rename" }).eq("id", f.teamId);
  assert.equal(await readBudget(f), 100000000);
  assert.ok((await anonymous.rpc("save_my_complete_fantasy_team", {
    p_gameweek_id: f.weeks[0].id, p_squad: selection(f), p_chip: null,
  })).error, "Anonymous save must be denied");

  const email = `security-outsider-${randomUUID()}@example.invalid`;
  const { user } = checked(await f.admin.auth.admin.createUser({
    email, password: f.password, email_confirm: true,
  }), "Create outsider");
  try {
    const outsider = createClient(f.url, f.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    checked(await outsider.auth.signInWithPassword({ email, password: f.password }), "Sign in outsider");
    await outsider.from("fantasy_teams").update({ budget: 500000000 }).eq("id", f.teamId);
    await outsider.from("fantasy_teams").update({ name: "Outsider rename" }).eq("id", f.teamId);
    assert.equal(await readBudget(f), 100000000);
    assert.equal(checked(await f.user.from("fantasy_teams").select("name")
      .eq("id", f.teamId).single(), "Read owner name").name, `Functional ${f.id}`);
  } finally {
    checked(await f.admin.auth.admin.deleteUser(user.id), "Remove outsider");
  }
});

test("owner cannot modify budget or use a mixed update or upsert to save an over-budget squad", async (t) => {
  const f = await fixtureFor(t);
  checked(await f.admin.from("players").update({ price: 60000000 }).eq("id", f.players[0].id), "Set synthetic player price");
  const before = await save(f, selection(f));
  assert.match(before.error?.message ?? "", /budget/i, "110m squad must initially exceed the 100m budget");

  // Attack requests use only the signed-in user's session and public key.
  for (const budget of [200000000, 50000000, 100000000, null]) {
    const update = await f.user.from("fantasy_teams").update({ budget }).eq("id", f.teamId);
    assert.equal(update.error?.code, "42501", "Even a same-value budget update must lack permission");
    assert.equal(await readBudget(f), 100000000);
  }
  const mixed = await f.user.from("fantasy_teams")
    .update({ budget: 200000000, name: "Rejected rename" }).eq("id", f.teamId);
  assert.equal(mixed.error?.code, "42501");
  const upsert = await f.user.from("fantasy_teams").upsert({
    id: f.teamId, user_id: f.userId, name: "Rejected upsert", budget: 200000000,
  });
  assert.ok(upsert.error, "Upsert must not bypass update privileges");
  assert.equal(await readBudget(f), 100000000);
  assert.equal(checked(await f.user.from("fantasy_teams").select("name")
    .eq("id", f.teamId).single(), "Read unchanged team").name, `Functional ${f.id}`);
  const afterSave = await save(f, selection(f));
  assert.match(afterSave.error?.message ?? "", /budget/i, "Expensive squad must still be rejected");
  assert.deepEqual(await readSquad(f), [], "Rejected squad must not persist");
});

test("owner cannot create a team with any nonstandard starting budget", async (t) => {
  const f = await fixtureFor(t);
  checked(await f.admin.from("fantasy_teams").delete().eq("id", f.teamId), "Remove setup team");
  for (const budget of [500000000, 99999999, 0, -1, null]) {
    const result = await f.user.from("fantasy_teams").insert({
      id: f.teamId, user_id: f.userId, name: `Invalid ${f.id}`, budget,
    });
    assert.equal(result.error?.code, "42501", "Nonstandard starting budget must fail RLS");
    const stored = checked(await f.admin.from("fantasy_teams").select("budget")
      .eq("id", f.teamId).maybeSingle(), "Read attempted team");
    assert.equal(stored, null, "Rejected insert must leave no team row");
  }
});

test("gameweek lock denies owner budget edits while allowing a rename without changing the snapshot", async (t) => {
  const f = await fixtureFor(t);
  checked(await save(f, selection(f)), "Save valid squad");
  const snapshotBefore = await lock(f);
  assert.equal(checked(await f.user.rpc("current_transfer_lock"), "Read lock")[0].is_locked, true);
  const result = await f.user.from("fantasy_teams").update({ budget: 300000000 }).eq("id", f.teamId);
  assert.equal(result.error?.code, "42501");
  assert.equal(await readBudget(f), 100000000, "Owner budget edits must be denied during a lock as well");
  checked(await f.user.from("fantasy_teams").update({ name: `Locked rename ${f.id}` })
    .eq("id", f.teamId), "Owner can still rename while locked");
  const snapshot = checked(await f.admin.from("fantasy_team_gameweek_snapshots")
    .select("*").eq("fantasy_team_id", f.teamId).single(), "Read locked snapshot");
  assert.deepEqual(snapshot, snapshotBefore);
});

test("service-role budget changes and trusted repricing still work without changing locked budgets", async (t) => {
  const f = await fixtureFor(t);
  checked(await save(f, selection(f)), "Save valid squad");
  checked(await f.admin.from("fantasy_teams").update({ budget: 120000000 })
    .eq("id", f.teamId), "Trusted server adjusts budget");
  assert.equal(await readBudget(f), 120000000);
  const snapshot = await lock(f);
  checked(await f.admin.from("fantasy_gameweeks")
    .update({ unlock_at: new Date(Date.now() - 60000).toISOString() })
    .eq("id", f.weeks[0].id), "Enter pending refresh window for an explicit reprice");
  checked(await f.admin.from("players").update({ price: 15000000 })
    .eq("id", f.players[0].id), "Explicit trusted reprice invokes cash-preservation trigger");
  assert.equal(await readBudget(f), 125000000, "Trigger must preserve unspent cash");
  const update = await f.user.from("fantasy_teams").update({ budget: 130000000 }).eq("id", f.teamId);
  assert.equal(update.error?.code, "42501");
  assert.equal(await readBudget(f), 125000000, "Owner cannot change a trusted adjusted budget");
  checked(await f.user.from("fantasy_teams").update({ name: `Adjusted ${f.id}`, onboarding_completed: true })
    .eq("id", f.teamId), "Rename still works with a non-default trusted budget");
  const locked = checked(await f.admin.from("fantasy_team_gameweek_snapshots")
    .select("*").eq("fantasy_team_id", f.teamId).single(), "Read preserved snapshot");
  assert.deepEqual(locked, snapshot);
});

for (const { label, invalidSquad, message } of [
  ...[4, 5].map((captain) => ({
    label: `captain in bench slot ${captain - 3}`,
    invalidSquad: (f) => selection(f, captain), message: /captain must be a starting player/i,
  })),
  { label: "no captain", invalidSquad: (f) => selection(f, -1), message: /exactly one captain/i },
  { label: "two captains", invalidSquad: (f) => selection(f).map((p, i) => ({
    ...p, is_captain: i === 0 || i === 4,
  })), message: /exactly one captain/i },
]) {
  test(`save RPC rejects ${label} without changing the valid squad or selecting a chip`, async (t) => {
    const f = await fixtureFor(t);
    checked(await save(f, selection(f)), "Save valid squad first");
    const original = await readSquad(f);
    const rows = invalidSquad(f);
    rows[3].player_id = f.players[8].id; // Attempt a transfer as well as invalid captaincy.
    const result = await save(f, rows, "triple_captain");
    assert.match(result.error?.message ?? "", message);
    assert.deepEqual(await readSquad(f), original, "Rejected save must leave all prior squad rows intact");
    assert.deepEqual(checked(await f.admin.from("fantasy_team_chip_selections")
      .select("chip").eq("fantasy_team_id", f.teamId), "Read chips after rejection"), []);
  });
}

test("ordinary users cannot bypass complete-save validation through private save functions", async (t) => {
  const f = await fixtureFor(t);
  checked(await save(f, selection(f)), "Save valid squad");
  const original = await readSquad(f);
  for (const name of ["save_my_fantasy_team", "save_my_fantasy_team_without_lineup_order"]) {
    const result = await f.user.rpc(name, {
      p_gameweek_id: f.weeks[0].id, p_squad: selection(f, 4), p_chip: null,
    });
    assert.equal(result.error?.code, "42501", "Internal save function must remain inaccessible");
  }
  assert.deepEqual(await readSquad(f), original);
});

test("administrative RPCs reject API users, including player merges that would bypass squad budgets", async (t) => {
  const f = await fixtureFor(t);
  checked(await save(f, selection(f)), "Save affordable squad");
  const original = await readSquad(f);
  checked(await f.admin.from("players").update({ price: 60000000 })
    .eq("id", f.players[8].id), "Set unowned synthetic expensive player price");
  const expensive = selection(f);
  expensive[0].player_id = f.players[8].id;
  assert.match((await save(f, expensive)).error?.message ?? "", /budget/i);

  const anonymous = createClient(f.url, f.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const client of [anonymous, f.user]) {
    for (const [name, args] of [
      ["merge_player_records", { keep_player_id: f.players[8].id, duplicate_player_id: f.players[0].id }],
      ["snapshot_locked_squads", {}],
      ["mark_used_chips", {}],
      ["calculate_player_match_stats", { target_gameweek_id: f.weeks[0].id }],
      ["calculate_fantasy_gameweek_points", { target_gameweek_id: f.weeks[0].id }],
      ["complete_gameweek_refresh", { p_gameweek_id: f.weeks[0].id, p_refreshed_at: new Date().toISOString() }],
    ]) {
      const result = await client.rpc(name, args);
      assert.equal(result.error?.code, "42501", `${name} must deny API users before any mutation`);
    }
  }
  assert.deepEqual(await readSquad(f), original, "Forbidden merge must not replace a player with an unaffordable one");
  assert.equal(await readBudget(f), 100000000);
  assert.ok(checked(await f.admin.from("players").select("id")
    .eq("id", f.players[0].id).single(), "Original player must not be deleted"));

  // Trusted jobs retain their existing administrative permissions.
  checked(await f.admin.rpc("mark_used_chips"), "Trusted chip maintenance");
  checked(await f.admin.rpc("merge_player_records", {
    keep_player_id: f.players[8].id, duplicate_player_id: f.players[9].id,
  }), "Trusted merge of two unowned synthetic players");
  assert.equal(checked(await f.admin.from("players").select("id")
    .eq("id", f.players[9].id).maybeSingle(), "Read merged duplicate"), null);
  assert.deepEqual(await readSquad(f), original);
});

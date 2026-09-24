import assert from "node:assert/strict";
import test from "node:test";
import { persistScoreAndComplete } from "./import-stupa-results.mjs";
import { completeOldestUnlockedGameweek } from "./complete-gameweek-refresh.mjs";

function query(result, calls) {
  return {
    select(columns) {
      calls.push(["select", columns]);
      return this;
    },
    eq(column, value) {
      calls.push(["eq", column, value]);
      return this;
    },
    is(column, value) {
      calls.push(["is", column, value]);
      return this;
    },
    limit(value) {
      calls.push(["limit", value]);
      return this;
    },
    lt(column, value) {
      calls.push(["lt", column, value]);
      return this;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    order(column, options) {
      calls.push(["order", column, options]);
      return this;
    },
  };
}

function createSupabase({
  gameweek = null,
  completed = null,
  completionError = null,
  scoringError = null,
}) {
  const calls = [];
  let fromCount = 0;

  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push(["rpc", name, args]);
        if (name === "calculate_fantasy_gameweek_points") {
          return { error: scoringError };
        }
        if (name === "complete_gameweek_refresh") {
          return { data: Boolean(completed), error: completionError };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      },
      from(table) {
        calls.push(["from", table]);
        fromCount += 1;

        if (fromCount === 1) {
          return query({ data: gameweek, error: null }, calls);
        }

        return {
          update(payload) {
            calls.push(["update", payload]);
            return query({ data: completed, error: null }, calls);
          },
        };
      },
    },
  };
}

test("results-only completion preserves prices and completes one unlocked gameweek", async () => {
  const refreshedAt = "2026-09-20T00:15:00.000Z";
  const gameweek = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Gameweek 1",
    unlock_at: "2026-09-20T00:00:00.000Z",
  };
  const { client, calls } = createSupabase({
    gameweek,
    completed: { id: gameweek.id },
  });

  const result = await completeOldestUnlockedGameweek(client, refreshedAt);

  assert.deepEqual(result, gameweek);
  assert.deepEqual(
    calls.find(([, name]) => name === "complete_gameweek_refresh"),
    ["rpc", "complete_gameweek_refresh", {
      p_gameweek_id: gameweek.id,
      p_refreshed_at: refreshedAt,
    }],
  );
  assert.equal(calls.filter(([, name]) => name === "complete_gameweek_refresh").length, 1);
  assert.ok(!JSON.stringify(calls).includes("players"));
  assert.ok(!JSON.stringify(calls).includes("fantasy_teams"));
});

test("results-only completion makes no update when nothing is pending", async () => {
  const { client, calls } = createSupabase({ gameweek: null });

  const result = await completeOldestUnlockedGameweek(
    client,
    "2026-09-20T00:15:00.000Z",
  );

  assert.equal(result, null);
  assert.equal(calls.filter(([operation]) => operation === "from").length, 1);
  assert.equal(calls.filter(([, name]) => name === "complete_gameweek_refresh").length, 0);
});

const rows = { matchUpdates: [], submatches: [], playerResults: [], gameweekIds: ["gw"], identityConflicts: [], missingParentMatches: [] };
const options = { complete: true, refreshStartedAt: "2026-09-20T00:15:00.000Z" };

test("results scoring precedes pending-gameweek scoring and the completion marker", async () => {
  const { client, calls } = createSupabase({ gameweek: { id: "gw", name: "GW" }, completed: { id: "gw" } });
  await persistScoreAndComplete(client, rows, options);
  assert.equal(calls[0][0], "rpc");
  const marker = calls.findIndex(([, name]) => name === "complete_gameweek_refresh");
  assert.equal(calls.slice(0, marker).filter(([operation]) => operation === "rpc").length, 2);
  assert.ok(calls.some(([operation, column, value]) => operation === "lt" && column === "unlock_at" && value === options.refreshStartedAt));
  assert.ok(calls.some(([operation, column, value]) => operation === "eq" && column === "stupa_stage_id" && value === 5727));
});

test("scheduled completion only considers its own stage; synthetic unlock targets its gameweek", async () => {
  const gameweeks = [
    { id: "synthetic-gw", name: "Test", stupa_stage_id: -900001, unlock_at: "2026-09-19T00:00:00Z" },
    { id: "real-gw", name: "Round 1", stupa_stage_id: 5727, unlock_at: "2026-09-19T12:00:00Z" },
  ];
  const completed = [];
  const client = {
    from(table) {
      assert.equal(table, "fantasy_gameweeks");
      const filters = new Map();
      return {
        select() { return this; }, lt() { return this; }, is() { return this; },
        eq(column, value) { filters.set(column, value); return this; },
        order() { return this; }, limit() { return this; },
        async maybeSingle() {
          return { data: gameweeks.find((week) => [...filters].every(([column, value]) => week[column] === value)) ?? null, error: null };
        },
      };
    },
    async rpc(name, args) {
      if (name === "complete_gameweek_refresh") completed.push(args.p_gameweek_id);
      return { data: true, error: null };
    },
  };
  await completeOldestUnlockedGameweek(client, options.refreshStartedAt, { stageId: 5727 });
  await completeOldestUnlockedGameweek(client, options.refreshStartedAt, { gameweekId: "synthetic-gw" });
  assert.deepEqual(completed, ["real-gw", "synthetic-gw"]);
});

test("failed result writes or scoring cannot reopen transfers", async () => {
  for (const failure of ["persist", "score"]) {
    const { client, calls } = createSupabase({ scoringError: failure === "score" ? { message: "failed" } : null });
    if (failure === "persist") client.from = () => ({ upsert: async () => ({ error: { message: "failed" } }) });
    await assert.rejects(persistScoreAndComplete(client, {
      ...rows, matchUpdates: failure === "persist" ? [{ id: "match" }] : [],
    }, options), /failed/);
    assert.equal(calls.filter(([, name]) => name === "complete_gameweek_refresh").length, 0);
    assert.equal(calls.filter(([operation]) => operation === "from").length, 0);
  }
});

test("failed pending-gameweek scoring leaves its marker null", async () => {
  const { client, calls } = createSupabase({ gameweek: { id: "gw" }, scoringError: { message: "failed" } });
  await assert.rejects(completeOldestUnlockedGameweek(client, options.refreshStartedAt), /failed/);
  assert.equal(calls.filter(([, name]) => name === "complete_gameweek_refresh").length, 0);
});

test("missing schedules and identity conflicts block completion before writes", async () => {
  for (const invalid of [{ missingParentMatches: [1] }, { identityConflicts: [{}] }]) {
    const { client, calls } = createSupabase({});
    await assert.rejects(persistScoreAndComplete(client, { ...rows, ...invalid }, options));
    assert.deepEqual(calls, []);
  }
});

test("ordinary result imports do not complete a gameweek", async () => {
  const { client, calls } = createSupabase({});
  await persistScoreAndComplete(client, rows);
  assert.deepEqual(calls.map(([operation]) => operation), ["rpc"]);
});

test("unmatched players are stored unlinked while known players score and the gameweek completes", async () => {
  const pending = createSupabase({ gameweek: { id: "gw", name: "GW" }, completed: { id: "gw" } });
  const writes = [];
  const client = {
    rpc: pending.client.rpc,
    from(table) {
      if (table === "fantasy_gameweeks") return pending.client.from(table);
      return {
        async upsert(payload) {
          writes.push({ table, payload });
          return { error: null };
        },
        update(payload) {
          return {
            eq(key, value) { writes.push({ table, payload, key, value }); return this; },
            in(key, value) { writes.push({ table, payload, key, value }); return this; },
            then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
          };
        },
      };
    },
  };
  const playerResults = [
    { stupa_submatch_id: 101, stupa_user_role_id: 1234, stupa_license_id: "known", player_id: "known-player" },
    { stupa_submatch_id: 101, stupa_user_role_id: 5678, stupa_license_id: "unknown", player_id: null },
  ];
  await persistScoreAndComplete(client, {
    ...rows, playerResults, unmatchedPlayers: [{ name: "Unknown Player" }],
  }, options);
  assert.deepEqual(writes.find((write) => write.table === "player_submatch_results").payload, playerResults);
  assert.deepEqual(writes.filter((write) => write.table === "players").map((write) => write.value), ["known-player"]);
  const identities = writes.find((write) => write.table === "player_external_identities" && Array.isArray(write.payload)).payload;
  assert.ok(identities.every((identity) => identity.player_id === "known-player"));
  assert.equal(identities.some((identity) => identity.external_id === "unknown" || identity.external_id === "5678"), false);
  assert.equal(pending.calls.filter(([operation]) => operation === "rpc").length, 3);
  assert.ok(pending.calls.some(([, name]) => name === "complete_gameweek_refresh"));
});

test("completion needs a captured import start time and detects concurrent completion", async () => {
  const first = createSupabase({});
  await assert.rejects(persistScoreAndComplete(first.client, rows, { complete: true }), /start time/);
  assert.deepEqual(first.calls, []);
  const concurrent = createSupabase({ gameweek: { id: "gw", name: "GW" }, completed: null });
  await assert.rejects(completeOldestUnlockedGameweek(concurrent.client, options.refreshStartedAt), /another process/);
});

function localRefreshDatabase({ unlocked = true, refreshed = false, scoringFailure = false } = {}) {
  const state = [
    { id: "older-real-round", name: "Real round", stupa_round_id: 1, unlock_at: "2020-01-01T00:00:00Z", data_refreshed_at: null },
    { id: "test-gw", name: "Test GW", stupa_round_id: -901001, unlock_at: unlocked ? "2020-01-02T00:00:00Z" : "2999-01-01T00:00:00Z", data_refreshed_at: refreshed ? "2020-01-03T00:00:00Z" : null },
  ];
  const events = [];
  const matches = [{ id: "test-match", stupa_match_id: -902001, fantasy_gameweek_id: "test-gw" }];
  const chipSelections = [];
  const client = {
    async rpc(name, args) {
      if (name === "calculate_fantasy_gameweek_points") {
        events.push(["score", name, args]);
        return { error: scoringFailure ? { message: "scoring failed" } : null };
      }
      if (name === "complete_gameweek_refresh") {
        const gameweek = state.find((row) => row.id === args.p_gameweek_id);
        const canComplete = gameweek && !gameweek.data_refreshed_at &&
          Date.parse(gameweek.unlock_at) < Date.parse(args.p_refreshed_at);
        if (!canComplete) return { data: false, error: null };
        gameweek.data_refreshed_at = args.p_refreshed_at;
        events.push(["complete", gameweek.id]);
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      assert.ok(
        ["fantasy_gameweeks", "matches", "fantasy_team_chip_selections"].includes(table),
        "Unlock must not write player prices or budgets",
      );
      const predicates = [];
      let update;
      const execute = () => {
        const rows = (table === "matches" ? matches : table === "fantasy_team_chip_selections" ? chipSelections : state)
          .filter((row) => predicates.every((predicate) => predicate(row)));
        if (update) for (const row of rows) {
          events.push([update.data_refreshed_at ? "complete" : "move-unlock-time", row.id]);
          Object.assign(row, update);
        }
        return rows.map((row) => ({ ...row }));
      };
      return {
        select() { return this; }, order() { return this; }, limit() { return this; },
        eq(key, value) { predicates.push((row) => row[key] === value); return this; },
        is(key, value) { return this.eq(key, value); },
        not(key, operator, value) {
          assert.equal(operator, "is");
          predicates.push((row) => row[key] !== value);
          return this;
        },
        lt(key, value) { predicates.push((row) => Date.parse(row[key]) < Date.parse(value)); return this; },
        update(values) { update = values; return this; },
        then(resolve, reject) {
          return Promise.resolve().then(() => ({ data: execute(), error: null })).then(resolve, reject);
        },
        async maybeSingle() {
          return { data: execute()[0] ?? null, error: null };
        },
      };
    },
  };
  return { client, state, events };
}

const testDefinition = { key: "gw1", roundId: -901001 };

test("local refresh verifies synthetic results then clears only the selected round; retries are idempotent", async () => {
  const { completeTestGameweekResults } = await import("./staging-gameweek-test.mjs");
  const db = localRefreshDatabase();
  const verify = async (client, scenario, definition, updateTimes) => {
    assert.equal(client, db.client);
    assert.equal(definition, testDefinition);
    assert.equal(updateTimes, false);
    assert.equal(db.state[1].data_refreshed_at, null);
    db.events.push(["verify-results"]);
  };
  await completeTestGameweekResults(db.client, {}, testDefinition, verify);
  assert.deepEqual(db.events.map(([event]) => event), ["verify-results", "score", "complete"]);
  assert.equal(db.state[0].data_refreshed_at, null);
  assert.ok(db.state[1].data_refreshed_at);
  const after = structuredClone(db.state);
  await completeTestGameweekResults(db.client, {}, testDefinition, verify);
  assert.deepEqual(db.state, after);
  assert.equal(db.events.length, 3);
});

test("local refresh keeps transfers closed on result verification or scoring failure", async () => {
  const { completeTestGameweekResults } = await import("./staging-gameweek-test.mjs");
  for (const scoringFailure of [false, true]) {
    const db = localRefreshDatabase({ scoringFailure });
    await assert.rejects(completeTestGameweekResults(db.client, {}, testDefinition, async () => {
      if (!scoringFailure) throw new Error("result verification failed");
    }), /failed/);
    assert.equal(db.state[1].data_refreshed_at, null);
    assert.equal(db.events.some(([event]) => event === "complete"), false);
  }
});

test("local refresh refuses a gameweek before its unlock time", async () => {
  const { completeTestGameweekResults } = await import("./staging-gameweek-test.mjs");
  const db = localRefreshDatabase({ unlocked: false });
  await assert.rejects(completeTestGameweekResults(db.client, {}, testDefinition, async () => {
    assert.fail("Must not import results before the selected round unlocks");
  }), /Run unlock first/);
  assert.deepEqual(db.events, []);
});


test("unlock completes verified scoring in one command without a separate refresh", async () => {
  const { unlock } = await import("./staging-gameweek-test.mjs");
  const db = localRefreshDatabase({ unlocked: false });
  const definition = { ...testDefinition, fixtures: [{ matchId: -902001, startsAfterMinutes: 0, durationMinutes: 60 }] };
  await unlock(db.client, {}, definition, async (client, scenario, selected, updateTimes) => {
    assert.equal(selected, definition);
    assert.equal(updateTimes, false);
    assert.ok(Date.parse(db.state[1].unlock_at) < Date.now());
    assert.equal(db.state[1].data_refreshed_at, null);
    db.events.push(["verify-results"]);
  });
  assert.deepEqual(db.events.map(([event]) => event), ["move-unlock-time", "move-unlock-time", "verify-results", "score", "complete"]);
  assert.ok(db.state[1].data_refreshed_at);
  assert.equal(db.state[0].data_refreshed_at, null);
  const before = structuredClone(db.state);
  await unlock(db.client, {}, definition, async () => assert.fail("Already completed"));
  assert.deepEqual(db.state, before);
});

test("unlock leaves completion pending if synthetic result verification fails", async () => {
  const { unlock } = await import("./staging-gameweek-test.mjs");
  const db = localRefreshDatabase({ unlocked: false });
  const definition = { ...testDefinition, fixtures: [{ matchId: -902001, startsAfterMinutes: 0, durationMinutes: 60 }] };
  await assert.rejects(unlock(db.client, {}, definition, async () => { throw new Error("results failed"); }), /results failed/);
  assert.equal(db.state[1].data_refreshed_at, null);
  assert.equal(db.events.some(([event]) => event === "complete"), false);
});

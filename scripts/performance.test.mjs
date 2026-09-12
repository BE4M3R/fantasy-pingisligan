import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Run the actual server loader with a bounded PostgREST transport. No hosted
// database or credentials are needed for these regression checks.
async function loadLeaderboard({ rows = [], failAt = -1 } = {}) {
  const calls = [];
  const source = await readFile(new URL("../lib/leaderboard.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-public-key" } },
    require(name) {
      if (name === "server-only") return {};
      if (name === "next/cache") return { unstable_cache: (fn) => fn };
      if (name === "@supabase/supabase-js") return { createClient: () => ({
        rpc: () => ({ range: async (start, end) => {
          calls.push([start, end]);
          return start === failAt
            ? { data: null, error: { message: "database unavailable" } }
            : { data: rows.slice(start, end + 1), error: null };
        } }),
      }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { ...exports, calls };
}

const teams = Array.from({ length: 1203 }, (_, index) => ({
  user_id: `user-${index}`, team_name: `Team ${index}`, total_points: 1203 - index,
}));

test("standings beyond PostgREST's default row cap retain every team and absolute rank", async () => {
  const loader = await loadLeaderboard({ rows: teams });
  const result = await loader.getGlobalLeaderboard();
  assert.equal(result.error, null);
  assert.equal(result.data.length, 1203);
  assert.equal(result.data.at(-1).rank, 1203);
  assert.deepEqual(loader.calls, [[0, 499], [500, 999], [1000, 1499]]);
  const initial = loader.initialGlobalRows(result.data, "user-1202");
  assert.equal(initial.length, 11);
  assert.equal(initial.at(-1).rank, 1203);
  assert.equal(loader.initialGlobalRows(result.data, "user-2").length, 10);
  assert.equal(loader.initialGlobalRows(result.data, "absent").length, 10);
});

test("a failed later batch never becomes a successful partial leaderboard", async () => {
  const loader = await loadLeaderboard({ rows: teams, failAt: 500 });
  const result = await loader.getGlobalLeaderboard();
  assert.equal(result.data.length, 0);
  assert.ok(result.error);
});

test("empty and exact-batch-size leaderboards terminate correctly", async () => {
  for (const size of [0, 500, 1000]) {
    const loader = await loadLeaderboard({ rows: teams.slice(0, size) });
    const result = await loader.getGlobalLeaderboard();
    assert.equal(result.data.length, size);
    assert.equal(loader.calls.length, size / 500 + 1);
  }
});

async function loadRoute(userId) {
  const source = await readFile(new URL("../app/api/leaderboard/route.ts", import.meta.url), "utf8");
  const exports = {};
  let reads = 0;
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, URL,
    require(name) {
      if (name === "next/server") return { NextResponse: { json: Response.json } };
      if (name === "@/lib/supabase/server") return { createClient: async () => ({
        auth: { getClaims: async () => ({ data: { claims: { sub: userId } } }) },
      }) };
      if (name === "@/lib/leaderboard") return { getGlobalLeaderboard: async () => {
        reads++;
        return { data: teams, error: null };
      } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { GET: exports.GET, reads: () => reads };
}

test("leaderboard endpoint rejects anonymous and invalid requests before reading standings", async () => {
  const anonymous = await loadRoute(undefined);
  assert.equal((await anonymous.GET(new Request("http://localhost/api/leaderboard"))).status, 401);
  assert.equal(anonymous.reads(), 0);
  const signedIn = await loadRoute("user-0");
  for (const offset of ["-1", "1.5", "invalid", "Infinity", "9007199254740992"]) {
    assert.equal((await signedIn.GET(new Request(`http://localhost/api/leaderboard?offset=${offset}`))).status, 400);
  }
  assert.equal(signedIn.reads(), 0);
});

test("leaderboard endpoint bounds responses and prevents shared HTTP caching", async () => {
  const route = await loadRoute("user-0");
  const response = await route.GET(new Request("http://localhost/api/leaderboard?offset=1000"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const payload = await response.json();
  assert.equal(payload.rows.length, 50);
  assert.equal(payload.rows[0].user_id, "user-1000");
  assert.equal(payload.total, 1203);
  const end = await route.GET(new Request("http://localhost/api/leaderboard?offset=1203"));
  assert.equal((await end.json()).rows.length, 0);
});

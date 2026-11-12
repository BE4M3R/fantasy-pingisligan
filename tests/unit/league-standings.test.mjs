import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { isGameweekId } from "../../lib/competitions.ts";

test("in-place standings require authentication, validate selection and keep responses private", async () => {
  const source = await readFile(new URL("../../app/api/league-standings/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const calls = [];
  let userId;
  let failed = false;
  vm.runInNewContext(code, { exports, URL, require(name) {
    if (name === "next/server") return { NextResponse: { json: Response.json } };
    if (name === "@/lib/competitions") return { isGameweekId };
    if (name === "@/lib/supabase/server") return { getClaims: async () => ({ data: { claims: { sub: userId } } }) };
    if (name === "@/lib/league-standings") return { getLeagueStandings: async (...args) => {
      calls.push(args);
      return { rows: [], total: 0, error: failed ? "Unavailable" : null };
    } };
    throw new Error(`Unexpected import: ${name}`);
  } });
  const request = (query) => exports.GET(new Request(`http://localhost/api/league-standings?${query}`));
  assert.equal((await request("view=global")).status, 401);
  userId = "signed-in-manager";
  for (const query of ["", "view=private", "view=gameweek", "view=gameweek&gameweek=invalid"]) {
    assert.equal((await request(query)).status, 400);
  }
  assert.equal(calls.length, 0, "Rejected requests must not load standings");
  const week = "00000000-0000-4000-8000-000000000001";
  for (const query of ["view=global", `view=gameweek&gameweek=${week}`]) {
    const response = await request(query);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.deepEqual(calls, [["global", userId, undefined], ["gameweek", userId, week]]);
  failed = true;
  const unavailable = await request("view=global");
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("cache-control"), "private, no-store");
});

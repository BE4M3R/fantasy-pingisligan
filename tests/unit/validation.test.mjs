import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ESLint } from "eslint";
import { localEnvironment } from "../../scripts/run-local-tests.mjs";

test("validation overrides inherited hosted targets with disposable local credentials", () => {
  const environment = localEnvironment({
    API_URL: "http://127.0.0.1:40001", ANON_KEY: "local-anon", SERVICE_ROLE_KEY: "local-service",
  }, 40000, {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_URL: "https://example.supabase.co",
    FUNCTIONAL_TEST_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "hosted-anon",
    SUPABASE_SERVICE_ROLE_KEY: "hosted-service",
    FUNCTIONAL_TEST_ANON_KEY: "hosted-anon",
    FUNCTIONAL_TEST_SERVICE_ROLE_KEY: "hosted-service",
    TEST_APP_DIST_DIR: ".next", TEST_APP_TSCONFIG: "tsconfig.json",
  });
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "FUNCTIONAL_TEST_SUPABASE_URL"]) {
    assert.equal(environment[key], "http://127.0.0.1:40001");
  }
  for (const key of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "FUNCTIONAL_TEST_ANON_KEY"]) {
    assert.equal(environment[key], "local-anon");
  }
  for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "FUNCTIONAL_TEST_SERVICE_ROLE_KEY"]) {
    assert.equal(environment[key], "local-service");
  }
  assert.equal(environment.TEST_APP_DIST_DIR, ".next-test-40010");
  assert.equal(environment.TEST_APP_TSCONFIG, "tsconfig.test-40010.json");
  for (const url of ["https://example.supabase.co", "http://127.0.0.1:54321"]) {
    assert.throws(() => localEnvironment({ API_URL: url }, 40000), /unexpected API URL/);
  }
});

test("validation rejects target flags before starting any tests or database", () => {
  for (const args of [["--staging"], ["check", "--production"], ["functional", "--db-url=example"]]) {
    const result = spawnSync(process.execPath, ["scripts/run-local-tests.mjs", ...args], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Test targets cannot be overridden/);
    assert.equal(result.stdout, "");
  }
});

test("ESLint ignores generated test builds while still reporting source errors", async () => {
  const eslint = new ESLint();
  assert.equal(await eslint.isPathIgnored(".next-test-40010/server/app/page.js"), true);
  assert.equal(await eslint.isPathIgnored("lib/validation-probe.ts"), false);
  assert.equal(await eslint.isPathIgnored("tests/unit/validation.test.mjs"), false);
  const [result] = await eslint.lintText("export const value: any = 1;\n", { filePath: "lib/validation-probe.ts" });
  assert.ok(result.messages.some((message) => message.ruleId === "@typescript-eslint/no-explicit-any"));
});

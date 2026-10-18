import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  assertBackupTarget, assertHostedUrl, assertLocalUrl, assertTarget,
  browserEnvironment, developmentEnvironment, importTarget,
} from "../../scripts/environment.mjs";
import { nextEnvironment } from "../../scripts/run-next.mjs";
import { localSupabaseArgs } from "../../scripts/local-supabase.mjs";

const local = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-local-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-local-admin" };
const hosted = "https://syntheticproject.supabase.co";

test("target checks reject URL credentials, redirects, alternate protocols and disagreeing selectors", () => {
  assert.equal(assertLocalUrl(local.NEXT_PUBLIC_SUPABASE_URL), local.NEXT_PUBLIC_SUPABASE_URL);
  for (const url of [hosted, "http://localhost:54321", "https://127.0.0.1:54321",
    "http://127.0.0.1:54321/path", "http://user:password@127.0.0.1:54321", "http://127.0.0.1:54321?host=evil", "invalid"]) {
    assert.throws(() => assertLocalUrl(url), /Local safety/);
  }
  assert.equal(assertLocalUrl("http://127.0.0.1:40001", null), "http://127.0.0.1:40001");
  assert.equal(assertHostedUrl(hosted, "syntheticproject"), hosted);
  for (const url of [hosted + "/rest", hosted + "?x=y", hosted + ".evil", "http://syntheticproject.supabase.co", "https://u:p@syntheticproject.supabase.co"]) {
    assert.throws(() => assertHostedUrl(url, "syntheticproject"), /Hosted safety/);
  }
  assert.throws(() => assertTarget({ ...local, SUPABASE_URL: hosted }, "local"), /Local safety/);
  assert.throws(() => assertTarget({ SUPABASE_URL: hosted }, "production"), /expected project/);
  assert.throws(() => assertTarget(local, "typo"), /explicit/);
});

test("development children discard inherited provider credentials and remote Docker targets", () => {
  const env = developmentEnvironment({ PATH: "/synthetic/bin", SystemRoot: "C:\\Windows", HOME: "/synthetic/home",
    SUPABASE_URL: hosted, SUPABASE_ACCESS_TOKEN: "synthetic", SUPABASE_DB_URL: "synthetic",
    GH_TOKEN: "synthetic", GITHUB_TOKEN: "synthetic", VERCEL_TOKEN: "synthetic", BREVO_API_KEY: "synthetic",
    PGPASSWORD: "synthetic", PGHOST: "synthetic", DATABASE_URL: "synthetic", NODE_OPTIONS: "--require=evil",
    DOCKER_CONTEXT: "remote", DOCKER_CONFIG: "/operator/config", RANDOM_PRIVATE_KEY: "synthetic" });
  assert.deepEqual(env, { PATH: "/synthetic/bin", SystemRoot: "C:\\Windows", HOME: "/synthetic/home", DOCKER_CONTEXT: "default" });
  assert.throws(() => developmentEnvironment({ DOCKER_HOST: "tcp://remote:2376" }), /local Docker/);
  assert.equal(developmentEnvironment({ DOCKER_HOST: "unix:///run/user/123/docker.sock" }).DOCKER_HOST, "unix:///run/user/123/docker.sock");
});

test("local database entry points reject all target overrides before starting the CLI", () => {
  assert.deepEqual(localSupabaseArgs("reset", []), ["db", "reset", "--local"]);
  assert.deepEqual(localSupabaseArgs("status", []), ["migration", "list", "--local"]);
  assert.deepEqual(localSupabaseArgs("new", ["safe_migration"]), ["migration", "new", "safe_migration"]);
  for (const command of ["start", "stop", "reset", "lint", "status", "new"]) {
    for (const args of [["--linked"], ["--db-url", "synthetic"], ["--workdir", "elsewhere"]]) {
      assert.throws(() => localSupabaseArgs(command, args), /reject extra options/);
    }
  }
});

test("hosted imports require explicit intent and identity while the protected results caller stays compatible", () => {
  assert.throws(() => importTarget({ SUPABASE_URL: hosted }, []), /Local safety/);
  assert.throws(() => importTarget({ SUPABASE_URL: hosted }, ["--target", "production"]), /expected project/);
  assert.equal(importTarget({ SUPABASE_URL: hosted, PRODUCTION_PROJECT_REF: "syntheticproject" }, ["--target", "production"]), "production");
  const workflow = { SUPABASE_URL: hosted, GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "BE4M3R/fantasy-pingisligan",
    GITHUB_REF: "refs/heads/main", GITHUB_WORKFLOW: "Import Pingisligan results", GITHUB_EVENT_NAME: "schedule" };
  assert.equal(importTarget(workflow, []), "production");
  assert.throws(() => importTarget({ ...workflow, GITHUB_REF: "refs/heads/develop" }, []), /Local safety/);
  assert.equal(importTarget({ SUPABASE_URL: hosted, STAGING_PROJECT_REF: "syntheticproject" }, ["--target", "staging"]), "staging");
  assert.equal(importTarget({ SUPABASE_URL: hosted, PRODUCTION_PROJECT_REF: "syntheticproject" }, ["--target=production"]), "production");
  for (const args of [["--target"], ["--target="], ["--target", "typo"],
    ["--target", "local", "--target", "production"], ["--target=local", "--target=staging"]]) {
    assert.throws(() => importTarget(local, args), /Choose one --target/);
  }
});

test("imports load local keys as a complete set and accept the actual protected caller without local files", async () => {
  // Relocate the helper so every env-file read is confined to synthetic fixtures.
  const root = await mkdtemp(path.join(tmpdir(), "fpl-import-env-"));
  try {
    await mkdir(path.join(root, "scripts"));
    const modulePath = path.join(root, "scripts/environment.mjs");
    await copyFile(new URL("../../scripts/environment.mjs", import.meta.url), modulePath);
    const { importEnvironment } = await import(pathToFileURL(modulePath).href);
    const yaml = await readFile(new URL("../../.github/workflows/import-results.yml", import.meta.url), "utf8");
    const workflow = { SUPABASE_URL: hosted, SUPABASE_SERVICE_ROLE_KEY: "synthetic-protected-key",
      GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "BE4M3R/fantasy-pingisligan", GITHUB_REF: "refs/heads/main",
      GITHUB_WORKFLOW: yaml.match(/^name: (.+)$/m)[1], STUPA_STAGE_ID: "5727" };
    for (const event of ["schedule", "workflow_dispatch"]) {
      for (const args of [[], ["--complete-gameweek-refresh"]]) {
        const env = await importEnvironment(args, { ...workflow, GITHUB_EVENT_NAME: event });
        assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, workflow.SUPABASE_SERVICE_ROLE_KEY);
        assert.equal(env.SUPABASE_URL, hosted);
        assert.equal(env.STUPA_STAGE_ID, "5727");
      }
    }
    await writeFile(path.join(root, ".env.local"), Object.entries(local).map(([k, v]) => `${k}=${v}`).join("\n"));
    const env = await importEnvironment([], { SUPABASE_SERVICE_ROLE_KEY: "synthetic-inherited-key", GH_TOKEN: "synthetic", DRY_RUN: "1" });
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, local.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.DRY_RUN, "1");
    await assert.rejects(importEnvironment([], { SUPABASE_URL: hosted }), /Local safety/);
    await rm(path.join(root, ".env.local"));
    await assert.rejects(importEnvironment(["--target", "local", "--target", "production"], {}), /Choose one --target/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("import and cadence CLIs reject synthetic hosted mistakes before upstream network or local credential loading", () => {
  for (const script of ["import-stupa-schedule", "import-stupa-results", "results-refresh-schedule"]) {
    const result = spawnSync(process.execPath, [`scripts/${script}.mjs`], {
      env: { ...developmentEnvironment(), SUPABASE_URL: hosted, SUPABASE_SERVICE_ROLE_KEY: "synthetic" }, encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Local safety/);
    assert.doesNotMatch(result.stderr, /syntheticproject|fetch failed|synthetic-local/);
    assert.equal(result.stdout, "");
  }
});

test("local Next refuses auto-loaded operator files before reading them; explicit staging uses only its public key", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fpl-env-"));
  try {
    await writeFile(path.join(root, ".env.production"), "SUPABASE_SERVICE_ROLE_KEY=synthetic-never-load\n");
    await assert.rejects(nextEnvironment("build", [], {}, root), /refuses automatic env files/);
    await rm(path.join(root, ".env.production"));
    await writeFile(path.join(root, ".env.local"), Object.entries(local).map(([k, v]) => `${k}=${v}`).join("\n"));
    const { env } = await nextEnvironment("build", [], { GH_TOKEN: "synthetic" }, root);
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, local.NEXT_PUBLIC_SUPABASE_URL);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    await assert.rejects(nextEnvironment("dev", [], { SUPABASE_URL: hosted }, root), /Local safety/);
    for (const command of ["dev", "start"]) {
      await assert.rejects(nextEnvironment(command, [], { VERCEL: "1", SUPABASE_URL: hosted }, root), /Local safety/);
    }
    await writeFile(path.join(root, ".env.local"), `NEXT_PUBLIC_SUPABASE_URL=${local.NEXT_PUBLIC_SUPABASE_URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${local.NEXT_PUBLIC_SUPABASE_ANON_KEY}\n`);
    for (const command of ["dev", "build", "start"]) {
      const result = await nextEnvironment(command, [], {}, root);
      assert.equal(result.env.NEXT_PUBLIC_SUPABASE_URL, local.NEXT_PUBLIC_SUPABASE_URL);
      assert.equal(result.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    }
    await assert.rejects(nextEnvironment("dev", ["../operator-checkout"], {}, root), /directory and target overrides/);
    await writeFile(path.join(root, ".env.staging.local"), `SUPABASE_URL=${hosted}\nNEXT_PUBLIC_SUPABASE_URL=${hosted}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-public\nSTAGING_PROJECT_REF=syntheticproject\nSUPABASE_SERVICE_ROLE_KEY=synthetic-private\n`);
    await writeFile(path.join(root, ".env.production"), "SUPABASE_SERVICE_ROLE_KEY=synthetic-never-load\n");
    const staging = await nextEnvironment("dev", ["--target", "staging"], {}, root);
    assert.equal(staging.env.NEXT_PUBLIC_SUPABASE_URL, hosted);
    assert.equal(staging.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    await assert.rejects(nextEnvironment("build", ["--target", "staging"], {}, root), /requires dev/);
    const vercel = { VERCEL: "1", NEXT_PUBLIC_SUPABASE_URL: hosted };
    assert.equal((await nextEnvironment("build", [], vercel, root)).env, vercel);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("browser targets use a complete local credential set and ignore inherited admin keys", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fpl-browser-env-"));
  try {
    await writeFile(path.join(root, ".env.local"), Object.entries(local).map(([k, v]) => `${k}=${v}`).join("\n"));
    const env = await browserEnvironment({ SUPABASE_SERVICE_ROLE_KEY: "synthetic-hosted-admin", GH_TOKEN: "synthetic", PLAYWRIGHT_BROWSERS_PATH: "/synthetic/browsers" }, root);
    assert.equal(env.FUNCTIONAL_TEST_SERVICE_ROLE_KEY, local.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, "/synthetic/browsers");
    await assert.rejects(browserEnvironment({ NEXT_PUBLIC_SUPABASE_URL: hosted }, root), /Local safety/);
    await assert.rejects(browserEnvironment({ FUNCTIONAL_TEST_SUPABASE_URL: hosted }, root), /Local safety/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("backups match the expected project exactly and reject libpq target overrides", () => {
  const values = { SUPABASE_URL: hosted, SUPABASE_DB_URL: "postgresql://postgres.syntheticproject:synthetic@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require" };
  assert.doesNotThrow(() => assertBackupTarget(values));
  assert.doesNotThrow(() => assertBackupTarget({ SUPABASE_PROJECT_REF: "syntheticproject", SUPABASE_DB_URL: values.SUPABASE_DB_URL }));
  assert.throws(() => assertBackupTarget({ ...values, SUPABASE_PROJECT_REF: "wrongproject" }), /Hosted safety/);
  for (const db of [values.SUPABASE_DB_URL.replace("postgres.syntheticproject:", "postgres.wrong:"),
    values.SUPABASE_DB_URL.replace(".pooler.supabase.com", ".pooler.supabase.com.evil"),
    values.SUPABASE_DB_URL + "&host=elsewhere", values.SUPABASE_DB_URL.replace(":5432/", ":6543/")]) {
    assert.throws(() => assertBackupTarget({ ...values, SUPABASE_DB_URL: db }), /Backup target/);
  }
  assert.throws(() => assertBackupTarget({ SUPABASE_DB_URL: values.SUPABASE_DB_URL }), /Hosted safety/);
});

test("Playwright test listing needs no dotenv files or database credentials", () => {
  const result = spawnSync(process.execPath, ["scripts/run-browser-tests.mjs", "--list"], {
    env: developmentEnvironment(), encoding: "utf8", timeout: 20000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Total: \d+ tests/);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { developmentEnvironment } from "../../scripts/environment.mjs";
import { nextEnvironment } from "../../scripts/run-next.mjs";
import { stagingCommand, stagingEnvironment } from "../../scripts/run-staging.mjs";

const local = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-local-public",
};
const staging = {
  APP_ENV: "staging",
  STAGING_PROJECT_REF: "syntheticstaging",
  STUPA_STAGE_ID: "5727",
  SUPABASE_URL: "https://syntheticstaging.supabase.co",
  NEXT_PUBLIC_SUPABASE_URL: "https://syntheticstaging.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-staging-public",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-staging-admin",
};
const inherited = {
  SUPABASE_URL: "https://syntheticother.supabase.co",
  NEXT_PUBLIC_SUPABASE_URL: "https://syntheticother.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-other-public",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-other-admin",
  STAGING_PROJECT_REF: "syntheticother",
  PRODUCTION_PROJECT_REF: "syntheticother",
  APP_ENV: "production",
  STUPA_STAGE_ID: "999",
  SUPABASE_ACCESS_TOKEN: "synthetic-pat",
  SUPABASE_DB_URL: "synthetic-db",
  GH_TOKEN: "synthetic-gh",
  NODE_OPTIONS: "--require=synthetic",
  FUNCTIONAL_TEST_SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL,
  FUNCTIONAL_TEST_ANON_KEY: "synthetic-test-public",
};
const dotenv = (values) => Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");

test("npm development commands default to local and provide suffix staging equivalents", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const selected = {
    dev: ["scripts/run-next.mjs", "dev", "--hostname", "0.0.0.0"],
    "dev:staging": ["scripts/run-next.mjs", "dev", "--target", "staging", "--hostname", "127.0.0.1"],
    "seed:accounts": ["scripts/seed-staging-accounts.mjs", "--env", "local"],
    "seed:accounts:staging": ["scripts/seed-staging-accounts.mjs", "--env", "staging"],
    "test:gameweek": ["scripts/staging-gameweek-test.mjs", "--env", "local"],
    "test:gameweek:staging": ["scripts/staging-gameweek-test.mjs", "--env", "staging"],
    "check:results-refresh": ["scripts/results-refresh-schedule.mjs", "--local"],
    "check:results-refresh:staging": ["scripts/results-refresh-schedule.mjs", "--staging"],
    "export:players:staging": ["scripts/player-catalogue.mjs", "export-staging-candidate"],
  };
  for (const command of ["refresh", "verify", "schedule", "results"]) {
    const name = ["schedule", "results"].includes(command) ? `import:${command}` : command;
    selected[`${name}:staging`] = ["scripts/run-staging.mjs", command];
    if (name.startsWith("import:")) selected[`${name}:dry:staging`] = ["scripts/run-staging.mjs", command, "--dry-run"];
  }
  for (const [name, args] of Object.entries(selected)) {
    assert.deepEqual(scripts[name].split(" "), ["node", ...args], name);
  }
  for (const [oldName, name] of Object.entries({
    "seed:local-accounts": "seed:accounts", "seed:staging-accounts": "seed:accounts:staging",
    "test:local": "test:gameweek", "test:staging": "test:gameweek:staging",
    "check:results-refresh:local": "check:results-refresh",
    "export:players:staging-candidate": "export:players:staging",
  })) assert.equal(scripts[oldName], scripts[name]);
});

test("staging launcher fixes importer targets and rejects target and script overrides", () => {
  assert.deepEqual(stagingCommand("refresh"), { script: "refresh-staging.mjs", args: [] });
  assert.deepEqual(stagingCommand("verify"), { script: "verify-staging-refresh.mjs", args: [] });
  assert.deepEqual(stagingCommand("schedule", ["--dry-run"]), {
    script: "import-stupa-schedule.mjs", args: ["--target", "staging", "--dry-run"],
  });
  assert.deepEqual(stagingCommand("results", ["--complete-gameweek-refresh"]), {
    script: "import-stupa-results.mjs", args: ["--target", "staging", "--complete-gameweek-refresh"],
  });
  for (const command of ["refresh", "verify", "schedule", "results"]) {
    for (const args of [["--target", "production"], ["--target=production"], ["../other-script.mjs"]]) {
      assert.throws(() => stagingCommand(command, args), /overrides are forbidden/);
    }
  }
  assert.throws(() => stagingCommand("production"), /Choose/);
});

test("staging configuration is a complete file-sourced set, never shell credentials or a local fallback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pf-staging-env-"));
  try {
    await writeFile(path.join(root, ".env.local"), dotenv(local));
    await assert.rejects(stagingEnvironment(inherited, root), /Cannot load environment file/);
    await writeFile(path.join(root, ".env.staging.local"), dotenv(staging));
    const env = await stagingEnvironment(inherited, root);
    for (const [key, value] of Object.entries(staging)) assert.equal(env[key], value, key);
    for (const key of Object.keys(inherited).filter((key) => !(key in staging))) assert.equal(env[key], undefined, key);
    assert.equal((await stagingEnvironment({ ...inherited, DRY_RUN: "1" }, root)).DRY_RUN, "1");
    await writeFile(path.join(root, ".env.staging.local"), dotenv({ ...staging, NEXT_PUBLIC_SUPABASE_URL: inherited.SUPABASE_URL }));
    await assert.rejects(stagingEnvironment({}, root), /Hosted safety/);
    await writeFile(path.join(root, ".env.staging.local"), dotenv({ ...staging, STAGING_PROJECT_REF: "" }));
    await assert.rejects(stagingEnvironment({}, root), /Hosted safety/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Next staging uses its public file configuration despite inherited app and functional-test selectors", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pf-next-target-"));
  try {
    await writeFile(path.join(root, ".env.local"), dotenv(local));
    await writeFile(path.join(root, ".env.staging.local"), dotenv(staging));
    const { env } = await nextEnvironment("dev", ["--target", "staging"], inherited, root);
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, staging.NEXT_PUBLIC_SUPABASE_URL);
    assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, staging.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(env.SUPABASE_ACCESS_TOKEN, undefined);
    assert.equal(env.FUNCTIONAL_TEST_SUPABASE_URL, undefined);
    assert.equal((await nextEnvironment("dev", [], {}, root)).env.NEXT_PUBLIC_SUPABASE_URL, local.NEXT_PUBLIC_SUPABASE_URL);
    await rm(path.join(root, ".env.local"));
    await assert.rejects(nextEnvironment("dev", [], {}, root), /Cannot load environment file/);
    const { NEXT_PUBLIC_SUPABASE_URL: unused, ...withoutPublicUrl } = staging;
    void unused;
    await writeFile(path.join(root, ".env.staging.local"), dotenv(withoutPublicUrl));
    await assert.rejects(nextEnvironment("dev", ["--target", "staging"], {}, root), /Missing public Supabase/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("staging CLI passes file credentials and fixed args to children and propagates failure offline", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pf-staging-cli-"));
  try {
    await mkdir(path.join(root, "scripts"));
    for (const file of ["environment.mjs", "run-staging.mjs"]) {
      await copyFile(new URL(`../../scripts/${file}`, import.meta.url), path.join(root, "scripts", file));
    }
    await writeFile(path.join(root, ".env.staging.local"), dotenv(staging));
    const stub = `console.log(JSON.stringify({ args: process.argv.slice(2), url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, pat: process.env.SUPABASE_ACCESS_TOKEN }));`;
    for (const file of ["refresh-staging.mjs", "verify-staging-refresh.mjs", "import-stupa-schedule.mjs", "import-stupa-results.mjs"]) {
      await writeFile(path.join(root, "scripts", file), stub + (file === "verify-staging-refresh.mjs" ? "process.exitCode = 7;" : ""));
    }
    // Synthetic files and child stubs only: no real dotenv file or network is used.
    const env = { ...developmentEnvironment(), ...inherited };
    delete env.NODE_OPTIONS;
    for (const command of ["refresh", "verify", "schedule", "results"]) {
      const args = command === "schedule" ? ["--dry-run"] : [];
      const result = spawnSync(process.execPath, [path.join(root, "scripts/run-staging.mjs"), command, ...args], { env, encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error);
      assert.equal(result.status, command === "verify" ? 7 : 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        args: stagingCommand(command, args).args, url: staging.SUPABASE_URL, key: staging.SUPABASE_SERVICE_ROLE_KEY,
      });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

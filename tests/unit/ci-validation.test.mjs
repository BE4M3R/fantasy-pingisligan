import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { load } from "js-yaml";
import { assertCiResults, classifyChanges, detectChanges } from "../../scripts/ci-validation.mjs";
import { developmentEnvironment } from "../../scripts/environment.mjs";

const entry = fileURLToPath(new URL("../../scripts/ci-validation.mjs", import.meta.url));
const workflowFile = (name) => new URL(`../../.github/workflows/${name}`, import.meta.url);

test("documentation skips expensive jobs; code, dependencies and unknown configuration run normal coverage", () => {
  assert.deepEqual(classifyChanges(["README.md", "AGENTS.md", "docs/testing.md", "supabase/README.md",
    ".agents/skills/verify-ui/SKILL.md", "docs/diagram.svg", "docs/image.png"]), { tests: false, migrations: false });
  for (const file of ["app/page.tsx", "lib/rules.ts", "scripts/import-stupa-results.mjs", "package.json",
    "package-lock.json", ".npmrc", "next.config.ts", "proxy.ts", "tests/unit/example.test.mjs",
    "tests/browser/example.spec.mjs", "data/player-catalogue.json", "public/logo.svg", "docs/helper.js",
    "docs/config.yml", ".env.example", "unknown-new-config"]) {
    assert.deepEqual(classifyChanges(["README.md", file]), { tests: true, migrations: false }, file);
  }
  assert.deepEqual(classifyChanges([...Array.from({ length: 4000 }, (_, i) => `docs/${i}.md`), "app/page.tsx"]),
    { tests: true, migrations: false });
});

test("migration, workflow/security configuration and schema-test changes require migration validation too", () => {
  for (const file of ["supabase/migrations/new.sql", "supabase/config.toml", "supabase/seed.sql",
    ".github/workflows/pull-request-ci.yml", ".github/workflows/database-deploy-production.yml",
    ".github/workflows/import-results.yml", ".github/actions/example/action.yml", "scripts/ci-validation.mjs",
    "scripts/check-schema-upgrade.mjs", "scripts/results-refresh-dispatch.local.sql",
    "tests/fixtures/schema-upgrade/legacy.sql"]) {
    assert.deepEqual(classifyChanges([file]), { tests: true, migrations: true }, file);
  }
});

function results(tests, migrations = false) {
  return {
    changes: { result: "success", outputs: { tests: String(tests), migrations: String(migrations) } },
    "code-and-unit": { result: tests ? "success" : "skipped" },
    "functional-and-browser": { result: tests ? "success" : "skipped" },
    "migration-validation": { result: migrations ? "success" : "skipped" },
  };
}

test("the gate accepts only successful required jobs or explicitly unselected skips", () => {
  for (const [tests, migrations] of [[false, false], [true, false], [true, true]]) {
    const needs = results(tests, migrations);
    assert.doesNotThrow(() => assertCiResults(needs));
    for (const job of Object.keys(needs)) {
      for (const result of ["success", "failure", "cancelled", "skipped", "in_progress", undefined]) {
        const changed = structuredClone(needs);
        changed[job].result = result;
        if (result === needs[job].result) assert.doesNotThrow(() => assertCiResults(changed));
        else assert.throws(() => assertCiResults(changed), /did not succeed|must be/);
      }
      const missing = structuredClone(needs);
      delete missing[job];
      assert.throws(() => assertCiResults(missing));
    }
  }
  for (const output of [undefined, {}, { tests: "false" }, { tests: "false", migrations: "invalid" }]) {
    const needs = results(false);
    needs.changes.outputs = output;
    assert.throws(() => assertCiResults(needs), /selection/);
  }
  assert.throws(() => assertCiResults(results(false, true)), /also require application tests/);
});

test("actual Git diff and CLI handle merge commits, renamed/deleted code and unusual documentation filenames", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pf-ci-diff-"));
  const env = developmentEnvironment();
  const git = (...args) => execFileSync("git", ["-c", "user.name=CI Test", "-c", "user.email=ci@example.invalid",
    "-c", "commit.gpgsign=false", ...args], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const eventFile = path.join(cwd, "event.json");
  const outputFile = path.join(cwd, "outputs.txt");
  const cli = (mode, values = {}) => spawnSync(process.execPath, [entry, mode], { cwd, encoding: "utf8", timeout: 10000,
    env: { ...env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: eventFile, GITHUB_OUTPUT: outputFile, ...values } });
  try {
    git("init", "--initial-branch=main");
    await mkdir(path.join(cwd, "app"));
    await writeFile(path.join(cwd, "app/runtime.js"), "export const example = true;\n");
    git("add", ".");
    git("commit", "-m", "Base");
    const base = git("rev-parse", "HEAD");
    git("switch", "-c", "feature");
    // Windows does not allow newline characters in filenames.
    const docName = process.platform === "win32" ? "guide with spaces.md" : "guide\nwith spaces.md";
    await mkdir(path.join(cwd, "docs"));
    await writeFile(path.join(cwd, "docs", docName), "Documentation only.\n");
    git("add", "docs");
    git("commit", "-m", "Docs");
    git("switch", "main");
    git("merge", "--no-ff", "feature", "-m", "Merge docs");
    for (const ref of ["develop", "main", "feature/another-base"]) {
      await writeFile(eventFile, JSON.stringify({ pull_request: { base: { sha: base, ref } } }));
      assert.deepEqual(await detectChanges("pull_request", eventFile, cwd), { tests: false, migrations: false });
    }
    const docs = cli("changes");
    assert.ifError(docs.error);
    assert.equal(docs.status, 0, docs.stderr);
    assert.equal(await readFile(outputFile, "utf8"), "tests=false\nmigrations=false\n");
    await rename(path.join(cwd, "app/runtime.js"), path.join(cwd, "docs/retired.md"));
    git("add", "-A", "app", "docs");
    git("commit", "-m", "Rename code to docs");
    assert.deepEqual(await detectChanges("pull_request", eventFile, cwd), { tests: true, migrations: false });
    assert.deepEqual(await detectChanges("workflow_dispatch"), { tests: true, migrations: true });
    await assert.rejects(detectChanges("push", eventFile, cwd), /Unsupported/);
    await writeFile(eventFile, JSON.stringify({ pull_request: { base: { sha: "invalid" } } }));
    const bad = cli("changes");
    assert.ifError(bad.error);
    assert.notEqual(bad.status, 0);
    await writeFile(eventFile, JSON.stringify({ pull_request: { base: { sha: "a".repeat(40) } } }));
    await assert.rejects(detectChanges("pull_request", eventFile, cwd));
    for (const failed of [false, true]) {
      const needs = results(true, true);
      if (failed) needs["functional-and-browser"].result = "cancelled";
      const gate = cli("gate", { CI_NEEDS: JSON.stringify(needs) });
      assert.ifError(gate.error);
      assert.equal(gate.status, failed ? 1 : 0, gate.stderr);
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("PR workflow always reports one gate and reuses secret-free migration validation", async () => {
  const workflow = load(await readFile(workflowFile("pull-request-ci.yml"), "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["pull_request", "workflow_dispatch"]);
  assert.deepEqual(workflow.on.pull_request.types, ["opened", "synchronize", "reopened", "edited", "ready_for_review"]);
  for (const filter of ["paths", "paths-ignore", "branches", "branches-ignore"]) {
    assert.equal(workflow.on.pull_request[filter], undefined, `${filter} must not hide required checks`);
  }
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const jobs = workflow.jobs;
  assert.equal(jobs.changes.if, undefined);
  assert.equal(jobs.changes["continue-on-error"], undefined);
  assert.equal(jobs.changes.steps[0].with["fetch-depth"], 2);
  assert.equal(jobs.changes.steps[0].with["persist-credentials"], false);
  assert.equal(jobs.changes.steps.find((step) => step.id === "select").run, "node scripts/ci-validation.mjs changes");
  for (const step of jobs.changes.steps) {
    assert.equal(step.if, undefined);
    assert.equal(step["continue-on-error"], undefined);
  }
  assert.deepEqual(jobs.changes.outputs, {
    tests: "${{ steps.select.outputs.tests }}", migrations: "${{ steps.select.outputs.migrations }}",
  });
  for (const job of ["code-and-unit", "functional-and-browser", "migration-validation"]) {
    assert.equal(jobs[job].needs, "changes");
    assert.equal(jobs[job].if, `needs.changes.outputs.${job === "migration-validation" ? "migrations" : "tests"} == 'true'`);
    assert.equal(jobs[job]["continue-on-error"], undefined);
    for (const step of jobs[job].steps ?? []) assert.equal(step["continue-on-error"], undefined);
  }
  assert.equal(jobs["code-and-unit"].steps.find((step) => step.run === "npm run check").if, undefined);
  for (const command of ["npm run build", "npm run test:functional:db", "npm run test:e2e"]) {
    assert.equal(jobs["functional-and-browser"].steps.find((step) => step.run === command).if, undefined);
  }
  const gate = jobs["ci-gate"];
  assert.equal(gate.name, "CI gate");
  assert.equal(gate.if, "${{ always() }}");
  assert.equal(gate["continue-on-error"], undefined);
  assert.deepEqual(gate.needs, ["changes", "code-and-unit", "functional-and-browser", "migration-validation"]);
  const evaluation = gate.steps.find((step) => step.run === "node scripts/ci-validation.mjs gate");
  assert.equal(evaluation.env.CI_NEEDS, "${{ toJSON(needs) }}");
  assert.equal(evaluation.if, undefined);
  for (const step of gate.steps) assert.equal(step["continue-on-error"], undefined);
  assert.equal(jobs["migration-validation"].uses, "./.github/workflows/database-migrations-ci.yml");
  assert.equal(jobs["migration-validation"].secrets, undefined);
  const migrations = load(await readFile(workflowFile("database-migrations-ci.yml"), "utf8"));
  assert.deepEqual(Object.keys(migrations.on), ["workflow_call", "workflow_dispatch"]);
  assert.deepEqual(migrations.permissions, { contents: "read" });
  assert.equal(migrations.jobs.validate.environment, undefined);
  assert.equal(migrations.jobs.validate.if, undefined);
  assert.equal(migrations.jobs.validate["continue-on-error"], undefined);
  for (const step of migrations.jobs.validate.steps) assert.equal(step["continue-on-error"], undefined);
  assert.ok(migrations.jobs.validate.steps.some((step) => step.run?.includes("results-refresh-dispatch.local.sql")));
  assert.ok(migrations.jobs.validate.steps.some((step) => step.run === "supabase migration list --local"));
});

test("migration SQL validation fails on missing input or database errors, even when the other pipeline side succeeds", {
  skip: process.platform === "win32" ? "GitHub's Bash pipeline is exercised on Linux CI." : false,
}, async () => {
  const workflow = load(await readFile(workflowFile("database-migrations-ci.yml"), "utf8"));
  const step = workflow.jobs.validate.steps.find((step) => step.name === "Check results dispatch windows");
  const cwd = await mkdtemp(path.join(tmpdir(), "pf-ci-sql-pipeline-"));
  try {
    await mkdir(path.join(cwd, "scripts"));
    const docker = path.join(cwd, "docker");
    await writeFile(docker, '#!/bin/sh\ncat >/dev/null\nexit "$SYNTHETIC_SQL_EXIT"\n');
    await chmod(docker, 0o700);
    const sql = path.join(cwd, "scripts/results-refresh-dispatch.local.sql");
    for (const [inputExists, exitCode, succeeds] of [[true, "0", true], [true, "1", false], [false, "0", false]]) {
      if (inputExists) await writeFile(sql, "select 1;\n");
      else await rm(sql);
      const result = spawnSync("bash", ["-e", "-c", step.run], { cwd, encoding: "utf8",
        env: { ...developmentEnvironment(), PATH: `${cwd}:${process.env.PATH}`, SYNTHETIC_SQL_EXIT: exitCode } });
      assert.ifError(result.error);
      assert.equal(result.status === 0, succeeds, result.stderr);
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { load } from "js-yaml";

const workflowDirectory = new URL("../../.github/workflows/", import.meta.url);
const canonicalRepository = "BE4M3R/fantasy-pingisligan";
const repositories = [canonicalRepository, "contributor/fantasy-pingisligan"];
const refs = [
  "refs/heads/main", "refs/heads/develop", "refs/heads/feature/example",
  "refs/tags/main", "refs/tags/develop", "refs/tags/v1", "refs/pull/1/merge",
];
const events = [
  "push", "workflow_dispatch", "pull_request", "pull_request_target",
  "schedule", "repository_dispatch", "workflow_run", "workflow_call",
];

async function readWorkflow(filename) {
  return load(await readFile(new URL(filename, workflowDirectory), "utf8"));
}

function allows(job, context) {
  assert.equal(typeof job.if, "string");
  // Exercise the guards' equality/boolean subset with canonical inputs, as in
  // the A1 tests. This is not GitHub's expression engine or environment policy.
  return runInNewContext(job.if, context, { timeout: 1000 });
}

for (const [target, branch] of [["production", "main"], ["staging", "develop"]]) {
  test(`${target} migrations require the canonical branch, a deploy event and the existing enable flag`, async () => {
    const workflow = await readWorkflow(`database-deploy-${target}.yml`);
    const job = workflow.jobs.migrate;
    assert.equal(job.environment, target);
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.deepEqual(workflow.on.push.branches, [branch]);
    assert.deepEqual(workflow.on.push.paths, ["supabase/migrations/**"]);
    assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));

    for (const repository of repositories) {
      for (const ref of refs) {
        for (const event_name of events) {
          for (const enabled of ["true", "false", "", undefined]) {
            const expected = repository === canonicalRepository && ref === `refs/heads/${branch}` &&
              ["push", "workflow_dispatch"].includes(event_name) && enabled === "true";
            assert.equal(allows(job, {
              github: { repository, ref, event_name }, vars: { DATABASE_MIGRATIONS_ENABLED: enabled },
            }), expected, `${target}: ${repository} ${ref} ${event_name} enabled=${enabled}`);
          }
        }
      }
    }
  });
}

test("migration status only permits manual production/main and staging/develop pairs", async () => {
  const workflow = await readWorkflow("database-status.yml");
  const job = workflow.jobs.status;
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.environment.options, ["staging", "production"]);
  assert.equal(job.environment, "${{ inputs.environment }}");
  assert.deepEqual(workflow.permissions, { contents: "read" });

  for (const repository of repositories) {
    for (const ref of refs) {
      for (const event_name of events) {
        for (const environment of ["production", "staging", "Preview", "production-results", "", undefined]) {
          const expected = repository === canonicalRepository && event_name === "workflow_dispatch" &&
            ((environment === "production" && ref === "refs/heads/main") ||
             (environment === "staging" && ref === "refs/heads/develop"));
          assert.equal(allows(job, {
            github: { repository, ref, event_name }, inputs: { environment },
          }), expected, `${repository} ${ref} ${event_name} environment=${environment}`);
        }
      }
    }
  }
});

test("hosted credential consumers remain separate from local PR validation and results processing", async () => {
  const expectedConsumers = new Map([
    ["database-deploy-production.yml", ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_ID"]],
    ["database-deploy-staging.yml", ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_ID"]],
    ["database-status.yml", ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_ID"]],
    ["import-results.yml", ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]],
  ]);
  for (const filename of await readdir(workflowDirectory)) {
    if (!/\.ya?ml$/.test(filename)) continue;
    const source = await readFile(new URL(filename, workflowDirectory), "utf8");
    const secrets = [...new Set([...source.matchAll(/secrets\.(SUPABASE_[A-Z_]+)/g)].map((match) => match[1]))].sort();
    assert.deepEqual(secrets, expectedConsumers.get(filename) ?? [], `${filename}: review new credential consumers`);
    const workflow = load(source);
    if (!expectedConsumers.has(filename)) {
      for (const job of Object.values(workflow.jobs)) {
        assert.equal(job.environment, undefined, `${filename}: PR validation must remain outside hosted environments`);
      }
    }
    if (filename === "import-results.yml") {
      assert.equal(workflow.jobs["import-results"].environment, "production-results");
    }
    if (filename.startsWith("database-deploy-")) {
      assert.ok(workflow.jobs.migrate.steps.some((step) => step.run === "supabase db push --yes"));
    }
    if (filename === "database-status.yml") {
      assert.ok(workflow.jobs.status.steps.some((step) => step.run === "supabase db push --dry-run"));
      assert.ok(workflow.jobs.status.steps.every((step) => !/supabase db push --yes/.test(step.run ?? "")));
    }
    assert.doesNotMatch(source, /supabase link[^\n]*--debug/, `${filename}: avoid privileged CLI debug logging`);
  }
});

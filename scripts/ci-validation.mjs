import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function classifyChanges(files) {
  // Only known documentation is exempt; new code/configuration defaults to tests.
  const relevant = files.filter((file) => !/\.md$/i.test(file) &&
    !/^docs\/.*\.(png|jpe?g|gif|svg|webp|pdf|txt)$/i.test(file));
  return {
    tests: relevant.length > 0,
    migrations: relevant.some((file) => file.startsWith("supabase/") ||
      file.startsWith(".github/") || file.startsWith("tests/fixtures/schema-upgrade/") ||
      ["scripts/ci-validation.mjs", "scripts/check-schema-upgrade.mjs",
        "scripts/results-refresh-dispatch.local.sql"].includes(file)),
  };
}

export async function detectChanges(eventName, eventFile, cwd = process.cwd()) {
  if (eventName === "workflow_dispatch") return { tests: true, migrations: true };
  if (eventName !== "pull_request") throw new Error("Unsupported CI event.");
  const event = JSON.parse(await readFile(eventFile, "utf8"));
  const base = event.pull_request?.base?.sha;
  if (!/^[a-f0-9]{40}$/.test(base ?? "")) throw new Error("Missing PR base commit.");
  // Checkout supplies the PR merge commit and its parents (fetch-depth: 2).
  // Disabling rename detection includes both old and new paths. NUL separation
  // handles spaces/newlines and avoids GitHub API file-list truncation.
  const files = execFileSync("git", ["diff", "--no-ext-diff", "--no-renames",
    "--name-only", "-z", base, "HEAD"], {
    cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  return classifyChanges(files.split("\0").filter(Boolean));
}

export function assertCiResults(needs) {
  if (needs.changes?.result !== "success") throw new Error("Change detection did not succeed.");
  const flags = needs.changes.outputs;
  for (const name of ["tests", "migrations"]) {
    if (!["true", "false"].includes(flags?.[name])) throw new Error(`Missing or invalid ${name} selection.`);
  }
  if (flags.migrations === "true" && flags.tests !== "true") throw new Error("Migration changes also require application tests.");
  for (const [job, selection] of [
    ["code-and-unit", "tests"], ["functional-and-browser", "tests"],
    ["migration-validation", "migrations"],
  ]) {
    const expected = flags[selection] === "true" ? "success" : "skipped";
    if (needs[job]?.result !== expected) throw new Error(`${job} must be ${expected}; received ${needs[job]?.result ?? "missing"}.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "changes") {
      const flags = await detectChanges(process.env.GITHUB_EVENT_NAME, process.env.GITHUB_EVENT_PATH);
      await appendFile(process.env.GITHUB_OUTPUT, Object.entries(flags).map(([key, value]) => `${key}=${value}\n`).join(""));
      console.log(`Selected tests=${flags.tests}, migrations=${flags.migrations}.`);
    } else if (process.argv[2] === "gate") {
      assertCiResults(JSON.parse(process.env.CI_NEEDS));
      console.log("All selected CI jobs succeeded; unselected jobs were intentionally skipped.");
    } else throw new Error("Choose changes or gate.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

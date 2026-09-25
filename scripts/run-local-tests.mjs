import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCli = path.join(projectRoot, "node_modules", ".bin", "supabase");
const playwrightVersion = createRequire(import.meta.url)("@playwright/test/package.json").version;
const image = `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;
let activeChild;
let interrupted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    activeChild?.kill(signal);
  });
}

function run(command, args, { cwd = projectRoot, env = process.env, capture = false, allowInterrupted = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    activeChild = child;
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (activeChild === child) activeChild = undefined;
      if (code === 0 && (!interrupted || allowInterrupted)) return resolve(output);
      const safeLines = output.split(/\r?\n/)
        .filter((line) => line && !/KEY|SECRET|TOKEN|PASSWORD|postgresql:\/\//i.test(line))
        .slice(-12).join("\n");
      reject(new Error(`${command} ${args.join(" ")} failed${safeLines ? `:\n${safeLines}` : "."}`));
    });
  });
}

function freePort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function choosePortBase() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const base = randomInt(33000, 49000);
    const offsets = [0, 1, 2, 3, 4, 7, 9, 10];
    if ((await Promise.all(offsets.map((offset) => freePort(base + offset)))).every(Boolean)) return base;
  }
  throw new Error("Could not find free ports for the temporary test stack.");
}

function statusValues(output) {
  return Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, "$2")]] : [];
  }));
}

async function prepareProject(tempRoot, portBase) {
  const target = path.join(tempRoot, "supabase");
  await mkdir(target);
  await cp(path.join(projectRoot, "supabase", "migrations"), path.join(target, "migrations"), { recursive: true });
  let config = await readFile(path.join(projectRoot, "supabase", "config.toml"), "utf8");
  const projectId = `fpl-test-${randomBytes(5).toString("hex")}`;
  assert.match(config, /project_id = "fantasy-pingisligan"/);
  config = config.replace('project_id = "fantasy-pingisligan"', `project_id = "${projectId}"`);
  for (const [original, offset] of [[54320, 0], [54321, 1], [54322, 2], [54323, 3], [54324, 4], [54327, 7], [54329, 9]]) {
    config = config.replaceAll(String(original), String(portBase + offset));
  }
  await writeFile(path.join(target, "config.toml"), config);
}

function localEnvironment(values, portBase) {
  const url = `http://127.0.0.1:${portBase + 1}`;
  assert.equal(values.API_URL, url, "Temporary Supabase started on an unexpected API URL.");
  assert.ok(values.ANON_KEY && values.SERVICE_ROLE_KEY, "Temporary Supabase keys are missing.");
  return {
    ...process.env,
    FUNCTIONAL_TEST_SUPABASE_URL: url,
    FUNCTIONAL_TEST_ANON_KEY: values.ANON_KEY,
    FUNCTIONAL_TEST_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: values.ANON_KEY,
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${portBase + 10}`,
    TEST_APP_PORT: String(portBase + 10),
    TEST_APP_DIST_DIR: `.next-test-${portBase + 10}`,
    TEST_APP_TSCONFIG: `tsconfig.test-${portBase + 10}.json`,
    PLAYWRIGHT_TEST_ISOLATED: "1",
  };
}

function browserArgs(environment) {
  const args = ["run", "--rm", "--network", "host"];
  if (process.getuid && process.getgid) args.push("--user", `${process.getuid()}:${process.getgid()}`);
  args.push("-v", `${projectRoot}:/work`, "-w", "/work");
  for (const key of [
    "FUNCTIONAL_TEST_SUPABASE_URL", "FUNCTIONAL_TEST_ANON_KEY", "FUNCTIONAL_TEST_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SITE_URL", "TEST_APP_PORT", "TEST_APP_DIST_DIR",
    "TEST_APP_TSCONFIG",
    "PLAYWRIGHT_TEST_ISOLATED",
  ]) {
    assert.ok(environment[key], `Missing browser test environment variable: ${key}`);
    args.push("-e", key);
  }
  args.push(image, "npm", "run", "test:e2e");
  return args;
}

async function main() {
  let tempRoot;
  let testDistDir;
  let testTsconfig;
  let startAttempted = false;
  let stopSucceeded = false;
  const cliEnv = { ...process.env };
  for (const key of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_ID"]) delete cliEnv[key];
  try {
    await run("npm", ["run", "test:unit"]);
    const portBase = await choosePortBase();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "fpl-tests-"));
    await prepareProject(tempRoot, portBase);
    console.log("Starting a disposable local Supabase stack from repository migrations...");
    startAttempted = true;
    await run(supabaseCli, ["start"], { cwd: tempRoot, env: cliEnv, capture: true });
    const values = statusValues(await run(supabaseCli, ["status", "-o", "env"], {
      cwd: tempRoot, env: cliEnv, capture: true,
    }));
    const environment = localEnvironment(values, portBase);
    testDistDir = environment.TEST_APP_DIST_DIR;
    testTsconfig = environment.TEST_APP_TSCONFIG;
    console.log("Running database scenarios against the disposable stack...");
    await run("npm", ["run", "test:functional"], { env: environment });
    console.log("Running Chromium smoke tests in the matching Playwright container...");
    await writeFile(path.join(projectRoot, testTsconfig), '{"extends":"./tsconfig.json"}\n');
    await run("docker", browserArgs(environment), { env: environment });
    console.log("All local tests passed.");
  } finally {
    if (tempRoot && startAttempted) {
      console.log("Stopping disposable Supabase stack...");
      try {
        await run(supabaseCli, ["stop", "--no-backup"], { cwd: tempRoot, env: cliEnv, capture: true, allowInterrupted: true });
        stopSucceeded = true;
      } catch (error) {
        console.error(`Could not stop the temporary test stack. Configuration remains at ${tempRoot}.`);
        console.error(error.message);
      }
    }
    if (tempRoot && (!startAttempted || stopSucceeded)) await rm(tempRoot, { recursive: true, force: true });
    if (testDistDir) await rm(path.join(projectRoot, testDistDir), { recursive: true, force: true });
    if (testTsconfig) await rm(path.join(projectRoot, testTsconfig), { force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = interrupted ? 130 : 1;
});

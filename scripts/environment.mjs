import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

export async function readEnvironment(file, { optional = false } = {}) {
  try { return parseEnv(await readFile(file, "utf8")); }
  catch (error) {
    if (optional && error.code === "ENOENT") return {};
    // Never include file contents, URLs or credentials in errors.
    throw new Error(`Cannot load environment file (${error.code ?? "invalid format"}).`);
  }
}

export function assertLocalUrl(value, expected = "http://127.0.0.1:54321") {
  let url;
  try { url = new URL(value); } catch { /* handled below */ }
  if (!url || url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
      !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (expected && url.origin !== expected)) {
    throw new Error("Local safety check failed: expected an exact HTTP loopback Supabase target.");
  }
  return url.origin;
}

export function assertHostedUrl(value, projectRef) {
  let url;
  try { url = new URL(value); } catch { /* handled below */ }
  if (!/^[a-z0-9]+$/.test(projectRef ?? "") || !url ||
      url.href !== `https://${projectRef}.supabase.co/`) {
    throw new Error("Hosted safety check failed: URL must exactly match the expected project reference.");
  }
  return url.origin;
}

export function assertTarget(values, target, { localOrigin = "http://127.0.0.1:54321", projectRef } = {}) {
  if (!["local", "staging", "production"].includes(target)) throw new Error("Choose an explicit local, staging or production target.");
  const urls = [values.SUPABASE_URL, values.NEXT_PUBLIC_SUPABASE_URL].filter(Boolean);
  if (!urls.length) throw new Error("Missing Supabase target URL.");
  const origins = urls.map((url) => target === "local"
    ? assertLocalUrl(url, localOrigin)
    : assertHostedUrl(url, projectRef ?? values[`${target.toUpperCase()}_PROJECT_REF`]));
  if (new Set(origins).size !== 1) throw new Error("Supabase target URLs disagree.");
  return origins[0];
}

// An allowlist keeps unrelated provider keys, PATs, DB URLs, PG settings and
// NODE_OPTIONS out of ordinary validation children. This is not OS isolation.
export function developmentEnvironment(inherited = process.env) {
  const names = /^(PATH|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|USER|USERNAME|LOGNAME|SHELL|LANG|LC_.*|TERM|COLORTERM|CI|GITHUB_ACTIONS|NO_COLOR|FORCE_COLOR|DOCKER_HOST|XDG_RUNTIME_DIR)$/i;
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => names.test(key)));
  if (env.DOCKER_HOST && !/^(unix:\/\/\/|npipe:\/\/)/.test(env.DOCKER_HOST)) {
    throw new Error("Local tests require a local Docker socket or named pipe.");
  }
  // Do not let a cached remote Docker context choose the test host.
  env.DOCKER_CONTEXT = "default";
  if (env.DOCKER_HOST) delete env.DOCKER_CONTEXT;
  return env;
}

export function protectedResultsContext(env) {
  return env.GITHUB_ACTIONS === "true" && env.GITHUB_REPOSITORY === "BE4M3R/fantasy-pingisligan" &&
    env.GITHUB_REF === "refs/heads/main" && env.GITHUB_WORKFLOW === "Import Pingisligan results" &&
    ["schedule", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME);
}

// Existing protected workflow supplies its designated URL as project identity.
// Other hosted callers must explicitly provide the target and expected ref.
function explicitImportTarget(args) {
  const targets = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--target") targets.push(args[++index]);
    else if (args[index].startsWith("--target=")) targets.push(args[index].slice(9));
  }
  if (targets.length > 1 || (targets.length && !["local", "staging", "production"].includes(targets[0]))) {
    throw new Error("Choose one --target value: local, staging or production.");
  }
  return targets[0];
}

export function importTarget(env, args) {
  const protectedRun = protectedResultsContext(env);
  const target = explicitImportTarget(args) ?? (protectedRun ? "production" : "local");
  let projectRef = env[`${target?.toUpperCase()}_PROJECT_REF`];
  if (protectedRun && target === "production" && !projectRef) {
    try { projectRef = new URL(env.SUPABASE_URL).hostname.split(".")[0]; } catch { /* validator handles it */ }
  }
  assertTarget(env, target, { projectRef });
  return target;
}

export async function importEnvironment(args, inherited = process.env) {
  const explicitTarget = explicitImportTarget(args);
  // Validate inherited URLs before loading any local file or contacting STUPA.
  if (inherited.SUPABASE_URL || inherited.NEXT_PUBLIC_SUPABASE_URL) importTarget(inherited, args);
  const hosted = explicitTarget ? explicitTarget !== "local" : protectedResultsContext(inherited);
  const values = hosted ? { ...inherited } : {
    ...await readEnvironment(new URL("../.env.local", import.meta.url)),
  };
  // Preserve the existing safety switch even when other shell values are ignored.
  if (inherited.DRY_RUN === "1") values.DRY_RUN = "1";
  importTarget(values, args);
  return values;
}

export async function browserEnvironment(inherited = process.env, root = process.cwd()) {
  const isolated = inherited.FUNCTIONAL_TEST_SUPABASE_URL;
  const values = isolated ? {
    NEXT_PUBLIC_SUPABASE_URL: isolated,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: inherited.FUNCTIONAL_TEST_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: inherited.FUNCTIONAL_TEST_SERVICE_ROLE_KEY,
  } : await readEnvironment(path.join(root, ".env.local"));
  // Validate all supplied URL selectors; never mix inherited keys with file keys.
  if (inherited.NEXT_PUBLIC_SUPABASE_URL || inherited.SUPABASE_URL) {
    assertTarget(inherited, "local", { localOrigin: isolated ?? undefined });
  }
  const url = assertTarget(values, "local", { localOrigin: isolated ? null : undefined });
  if (!values.NEXT_PUBLIC_SUPABASE_ANON_KEY || !values.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Browser tests require local public and service-role keys.");
  }
  const env = developmentEnvironment(inherited);
  Object.assign(env, {
    FUNCTIONAL_TEST_SUPABASE_URL: url,
    FUNCTIONAL_TEST_ANON_KEY: values.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    FUNCTIONAL_TEST_SERVICE_ROLE_KEY: values.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: values.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: inherited.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3100",
    PLAYWRIGHT_TEST_ISOLATED: "1",
  });
  for (const key of ["TEST_APP_PORT", "TEST_APP_DIST_DIR", "TEST_APP_TSCONFIG"]) {
    if (inherited[key]) env[key] = inherited[key];
  }
  // The official Playwright image stores its installed browsers at this path.
  if (inherited.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = inherited.PLAYWRIGHT_BROWSERS_PATH;
  return env;
}

export function assertBackupTarget(values) {
  const projectUrl = values.SUPABASE_URL ?? values.NEXT_PUBLIC_SUPABASE_URL;
  let ref = values.SUPABASE_PROJECT_REF;
  if (!ref) {
    try { ref = new URL(projectUrl).hostname.split(".")[0]; } catch { /* validator handles it */ }
  }
  assertHostedUrl(projectUrl ?? `https://${ref}.supabase.co`, ref);
  if (projectUrl) assertTarget(values, "production", { projectRef: ref });
  let db;
  try { db = new URL(values.SUPABASE_DB_URL); } catch { /* handled below */ }
  if (!db || !["postgres:", "postgresql:"].includes(db.protocol) || !db.password ||
      db.username !== `postgres.${ref}` || !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(db.hostname) ||
      db.port !== "5432" || db.pathname !== "/postgres" || db.hash ||
      [...db.searchParams.keys()].some((key) => key !== "sslmode")) {
    throw new Error("Backup target must be the expected project's Session pooler URI (postgres.<ref>, port 5432, database postgres).");
  }
}

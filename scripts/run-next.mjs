import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTarget, developmentEnvironment, readEnvironment } from "./environment.mjs";

export async function assertLocalNextFiles(root = process.cwd(), { allowProductionFile = false } = {}) {
  const forbidden = (await readdir(root)).filter((name) =>
    name === ".env" || /^\.env\.(development|test)(\.local)?$/.test(name) ||
    (!allowProductionFile && /^\.env\.production(\.local)?$/.test(name)));
  if (forbidden.length) throw new Error(`Local Next refuses automatic env files: ${forbidden.join(", ")}. See docs/local-development-security.md.`);
}

export async function nextEnvironment(command, args, inherited = process.env, root = process.cwd()) {
  if (!["dev", "build", "start"].includes(command)) throw new Error("Choose dev, build or start.");
  // Vercel retains its existing project/environment configuration and Next loader.
  if (command === "build" && inherited.VERCEL === "1") return { env: inherited, args };
  const hosted = args[0] === "--target" && args[1] === "staging";
  if (args.includes("--target") && !hosted) throw new Error("Only explicit staging app inspection is supported.");
  if (hosted && command !== "dev") throw new Error("Staging app inspection requires dev.");
  // Fail before reading ANY dotenv file. Next has no public skip-dotenv option.
  // A target override in the shell would not stop it reading other secret files.
  // Explicit operator staging inspection uses development mode, which never
  // loads production dotenv files. Ordinary local commands keep the full guard.
  await assertLocalNextFiles(root, { allowProductionFile: hosted });
  const nextArgs = hosted ? args.slice(2) : args;
  for (let index = 0; index < nextArgs.length; index++) {
    const arg = nextArgs[index];
    if (["--webpack", "--turbopack", "--turbo"].includes(arg)) continue;
    if (["--port", "-p"].includes(arg) && /^\d+$/.test(nextArgs[++index] ?? "")) continue;
    if (["--hostname", "-H"].includes(arg) && ["localhost", "127.0.0.1", "0.0.0.0"].includes(nextArgs[++index])) continue;
    throw new Error("Unsupported local Next option. Project directory and target overrides are forbidden.");
  }
  const env = developmentEnvironment(inherited);
  const isolated = !hosted && inherited.FUNCTIONAL_TEST_SUPABASE_URL;
  const values = isolated ? {
    NEXT_PUBLIC_SUPABASE_URL: isolated,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: inherited.FUNCTIONAL_TEST_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: inherited.NEXT_PUBLIC_SITE_URL,
  } : await readEnvironment(path.join(root, hosted ? ".env.staging.local" : ".env.local"));
  assertTarget(values, hosted ? "staging" : "local", { localOrigin: isolated ? null : undefined });
  if (!hosted && (inherited.SUPABASE_URL || inherited.NEXT_PUBLIC_SUPABASE_URL)) {
    assertTarget(inherited, "local", { localOrigin: isolated ?? undefined });
  }
  if (!values.NEXT_PUBLIC_SUPABASE_URL || !values.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Missing public Supabase URL or key.");
  }
  // Next will also load .env.local; reject operator credentials there by name.
  const local = isolated || hosted ? await readEnvironment(path.join(root, ".env.local"), { optional: true }) : values;
  for (const key of Object.keys(local)) {
    if (/TOKEN|PASSWORD|SECRET|PRIVATE|DB_URL|DATABASE_URL|BREVO|VERCEL|PRODUCTION|STAGING/i.test(key) &&
        key !== "SUPABASE_SERVICE_ROLE_KEY") throw new Error("Keep operator credentials out of .env.local.");
  }
  if (Object.keys(local).length && (isolated || hosted)) assertTarget(local, "local");
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL"]) {
    if (values[key]) env[key] = values[key];
  }
  for (const key of ["TEST_APP_DIST_DIR", "TEST_APP_TSCONFIG", "TEST_APP_PORT", "PLAYWRIGHT_TEST_ISOLATED"]) {
    if (inherited[key]) env[key] = inherited[key];
  }
  return { env, args: nextArgs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const { env, args } = await nextEnvironment(command, process.argv.slice(3));
    const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), command, ...args], { env, stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
    child.on("error", () => { console.error("Could not start Next.js."); process.exitCode = 1; });
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

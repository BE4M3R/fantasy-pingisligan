import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTarget, developmentEnvironment, readEnvironment } from "./environment.mjs";

export function stagingCommand(command, args = []) {
  const scripts = {
    refresh: "refresh-staging.mjs",
    verify: "verify-staging-refresh.mjs",
    schedule: "import-stupa-schedule.mjs",
    results: "import-stupa-results.mjs",
  };
  if (!Object.hasOwn(scripts, command)) throw new Error("Choose refresh, verify, schedule or results.");
  const importer = command === "schedule" || command === "results";
  const allowed = importer ? ["--dry-run", ...(command === "results" ? ["--complete-gameweek-refresh"] : [])] : [];
  if (args.some((arg) => !allowed.includes(arg))) throw new Error("Unsupported staging option; target overrides are forbidden.");
  return { script: scripts[command], args: importer ? ["--target", "staging", ...args] : [] };
}

export async function stagingEnvironment(inherited = process.env, root = process.cwd()) {
  const values = await readEnvironment(path.join(root, ".env.staging.local"));
  assertTarget(values, "staging");
  const env = { ...developmentEnvironment(inherited), ...values };
  // Retain the existing safety switch without accepting shell credentials.
  if (inherited.DRY_RUN === "1") env.DRY_RUN = "1";
  return env;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const { script, args } = stagingCommand(process.argv[2], process.argv.slice(3));
    const env = await stagingEnvironment(process.env, root);
    const child = spawn(process.execPath, [path.join(root, "scripts", script), ...args], { env, stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
    child.on("error", () => { console.error("Could not start staging command."); process.exitCode = 1; });
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { developmentEnvironment } from "./environment.mjs";

export function localSupabaseArgs(command, args) {
  const commands = {
    start: ["start"], stop: ["stop"], reset: ["db", "reset", "--local"],
    lint: ["db", "lint", "--local", "--level", "error", "--fail-on", "error"],
    status: ["migration", "list", "--local"], new: ["migration", "new"],
  };
  if (!Object.hasOwn(commands, command) ||
      (command === "new" ? args.length !== 1 || !/^[a-z0-9][a-z0-9_-]*$/i.test(args[0]) : args.length !== 0)) {
    throw new Error("Local Supabase commands reject extra options and target overrides; new requires one migration name.");
  }
  return [...commands[command], ...args];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = localSupabaseArgs(process.argv[2], process.argv.slice(3));
    const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/supabase/dist/supabase.js", import.meta.url)), ...args], {
      env: developmentEnvironment(), stdio: "inherit",
    });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
    child.on("error", () => { console.error("Could not start local Supabase."); process.exitCode = 1; });
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

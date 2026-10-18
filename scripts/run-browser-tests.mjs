import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { browserEnvironment, developmentEnvironment } from "./environment.mjs";

try {
  // Listing discovers tests without launching a server or needing DB credentials.
  const env = process.argv.includes("--list") ? developmentEnvironment() : await browserEnvironment();
  const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url)), "test", ...process.argv.slice(2)], { env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", () => { console.error("Could not start Playwright."); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
} catch (error) { console.error(error.message); process.exitCode = 1; }

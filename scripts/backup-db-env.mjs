import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { assertBackupTarget, readEnvironment } from "./environment.mjs";

try {
  const [environment, envFile, destination] = process.argv.slice(2);
  if (!["staging", "production"].includes(environment) || !envFile || process.argv.length > 5) {
    throw new Error("Usage: node scripts/backup-db-env.mjs <staging|production> <env-file> [private-destination]");
  }
  const configured = await readEnvironment(envFile);
  assertBackupTarget(configured);
  // Existing named commands remain available. Pass the OLD destination explicitly
  // when continuing an existing backup history; never assume a cloud-sync folder.
  const backupRoot = resolve(destination ?? configured.SUPABASE_BACKUP_DIR ??
    process.env.SUPABASE_BACKUP_DIR ?? resolve(homedir(), "fantasy-pingisligan-db-backups", environment));
  const child = spawn("bash", ["scripts/backup-hosted-database.sh", backupRoot], {
    stdio: "inherit",
    env: { ...process.env, SUPABASE_DB_URL: configured.SUPABASE_DB_URL,
      SUPABASE_URL: configured.SUPABASE_URL ?? configured.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_URL: configured.NEXT_PUBLIC_SUPABASE_URL ?? configured.SUPABASE_URL,
      SUPABASE_PROJECT_REF: configured.SUPABASE_PROJECT_REF },
  });
  child.on("error", () => { console.error("Could not start database backup (Bash is required)."); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
} catch (error) { console.error(error.message); process.exitCode = 2; }

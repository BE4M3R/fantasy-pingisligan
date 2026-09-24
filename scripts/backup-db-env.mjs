import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const environment = process.argv[2];
const envFile = process.argv[3];
if (!new Set(["staging", "production"]).has(environment)) {
  console.error("Expected environment: staging or production.");
  process.exit(2);
}

if (!envFile) {
  console.error("Expected the environment file path as the second argument.");
  process.exit(2);
}

const configured = {};
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL|SUPABASE_DB_URL)\s*=\s*(.*?)\s*$/);
  if (!match) continue;
  const [, key, rawValue] = match;
  const quoted = rawValue.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/);
  configured[key] = quoted ? (quoted[1] ?? quoted[2]) : rawValue;
}

const databaseUrl = configured.SUPABASE_DB_URL;
const projectUrl = configured.NEXT_PUBLIC_SUPABASE_URL ?? configured.SUPABASE_URL;
if (!databaseUrl || !projectUrl) {
  console.error(`Add SUPABASE_DB_URL and the Supabase project URL to the environment file for ${environment}.`);
  process.exit(2);
}

let expectedRef;
let connectionIdentity;
let parsedDatabaseUrl;
try {
  expectedRef = new URL(projectUrl).hostname.split(".")[0];
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  console.error(`SUPABASE_DB_URL in the ${environment} env file is not a complete URL. In Supabase, open the matching project, select Connect, choose Session pooler, copy the URI connection string, and replace its password placeholder with the project's database password.`);
  process.exit(2);
}

connectionIdentity = `${decodeURIComponent(parsedDatabaseUrl.username)}@${parsedDatabaseUrl.hostname}`;
if (parsedDatabaseUrl.protocol !== "postgres:" && parsedDatabaseUrl.protocol !== "postgresql:") {
  console.error("SUPABASE_DB_URL must be a PostgreSQL connection URL starting with postgres:// or postgresql://.");
  process.exit(2);
}

if (parsedDatabaseUrl.hostname.startsWith("db.")) {
  console.error("SUPABASE_DB_URL is using the Direct connection (db.<project-ref>.supabase.co). In Supabase > Connect, choose Session pooler and replace it with that URI; the pooler hostname ends in .pooler.supabase.com and uses port 5432. The Direct endpoint may require IPv6, while the session pooler supports IPv4.");
  process.exit(2);
}

if (!parsedDatabaseUrl.username || !parsedDatabaseUrl.password) {
  console.error("SUPABASE_DB_URL must include the database username and password. Use the URI from Supabase > Connect > Session pooler, with your database password substituted.");
  process.exit(2);
}

if (!connectionIdentity.includes(expectedRef)) {
  console.error(`The database connection URL does not appear to match the ${environment} project URL (${expectedRef}).`);
  process.exit(2);
}

const backupRoot = resolve(
  "/mnt/c/Users/gusta/OneDrive/fantasy-pingisligan-db-backups",
  environment,
);
const child = spawn("bash", ["scripts/backup-hosted-database.sh", backupRoot], {
  stdio: "inherit",
  env: { ...process.env, ...configured },
});
child.on("error", (error) => {
  console.error(`Could not start database backup: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

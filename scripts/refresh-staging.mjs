import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyStagingImportTarget } from "./verify-staging-import-target.mjs";

verifyStagingImportTarget({
  supabaseUrl: process.env.SUPABASE_URL,
  publicUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  projectRef: process.env.STAGING_PROJECT_REF,
  appEnv: process.env.APP_ENV,
  stageId: process.env.STUPA_STAGE_ID,
});

for (const [script, args] of [
  ["import-stupa-schedule.mjs", []],
  ["import-stupa-results.mjs", ["--complete-gameweek-refresh"]],
  ["verify-staging-refresh.mjs", []],
]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

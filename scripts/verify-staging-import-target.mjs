import { fileURLToPath } from "node:url";

export function verifyStagingImportTarget({ supabaseUrl, publicUrl, serviceKey, projectRef, appEnv, stageId }) {
  if (appEnv !== "staging") {
    throw new Error("APP_ENV must be staging for a staging import.");
  }
  if (String(stageId) !== "5727") {
    throw new Error("STUPA_STAGE_ID must be 5727 for a staging import.");
  }
  if (!/^[a-z0-9]+$/.test(projectRef ?? "")) {
    throw new Error("Set STAGING_PROJECT_REF to the staging Supabase project reference.");
  }
  if (!serviceKey) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in .env.staging.local.");
  }
  let url;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error("Set SUPABASE_URL in .env.staging.local.");
  }
  if (url.origin !== `https://${projectRef}.supabase.co` || url.pathname !== "/" || url.search || url.hash || publicUrl !== supabaseUrl) {
    throw new Error("Staging import target does not match STAGING_PROJECT_REF.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    verifyStagingImportTarget({
      supabaseUrl: process.env.SUPABASE_URL,
      publicUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      projectRef: process.env.STAGING_PROJECT_REF,
      appEnv: process.env.APP_ENV,
      stageId: process.env.STUPA_STAGE_ID,
    });
    console.log("Staging Supabase target verified.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

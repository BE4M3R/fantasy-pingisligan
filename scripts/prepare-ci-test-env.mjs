import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

assert.equal(process.env.CI, "true", "This command only prepares a disposable CI runner.");
const output = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
const values = Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, "$2")]] : [];
}));
assert.equal(values.API_URL, "http://127.0.0.1:54321");
assert.ok(values.ANON_KEY && values.SERVICE_ROLE_KEY, "Local Supabase keys are missing.");
await writeFile(".env.local", [
  `NEXT_PUBLIC_SUPABASE_URL=${values.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${values.ANON_KEY}`,
  `SUPABASE_URL=${values.API_URL}`,
  `SUPABASE_SERVICE_ROLE_KEY=${values.SERVICE_ROLE_KEY}`,
  "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100",
  "",
].join("\n"), { mode: 0o600 });
console.log("Prepared local-only test environment.");

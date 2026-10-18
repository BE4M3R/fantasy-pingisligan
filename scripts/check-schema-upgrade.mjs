import assert from "node:assert/strict";
import { developmentEnvironment } from "./environment.mjs";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workdir = process.argv[2] ? path.resolve(process.argv[2]) : root;
assert.ok(process.argv.length <= 3, "Only a disposable project directory is accepted.");
const config = await readFile(path.join(workdir, "supabase/config.toml"), "utf8");
const projectId = config.match(/^project_id = "([a-z0-9-]+)"$/m)?.[1];
assert.ok(/^fpl-test-[a-f0-9]{10}$/.test(projectId ?? "") ||
  (process.env.CI === "true" && projectId === "fantasy-pingisligan"),
"Upgrade checks require a disposable test stack or the isolated CI runner.");

// Test the exact migration statements inside a larger rollback-only transaction.
// Production keeps its own transaction boundaries, including SET LOCAL limits.
const migrations = await Promise.all([
  "20261011120000_reconcile_legacy_snapshot_schema.sql",
  "20261012180000_reconcile_complete_squad_save_helper.sql",
].map(async (filename) => {
  const migration = await readFile(path.join(root, "supabase/migrations", filename), "utf8");
  assert.equal((migration.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((migration.match(/^commit;$/gm) ?? []).length, 1);
  return migration.replace(/^begin;$/m, "").replace(/^commit;$/m, "");
}));
const statements = migrations.join("\n");
const legacy = await readFile(path.join(root, "tests/fixtures/schema-upgrade/legacy-snapshots.sql"), "utf8");
const legacySave = await readFile(path.join(root, "tests/fixtures/schema-upgrade/legacy-squad-save.sql"), "utf8");
const formatting = await readFile(path.join(root, "tests/fixtures/schema-upgrade/editor-formatting.sql"), "utf8");
const fixture = await readFile(path.join(root, "tests/fixtures/schema-upgrade/data.sql"), "utf8");
const assertions = await readFile(path.join(root, "tests/fixtures/schema-upgrade/assertions.sql"), "utf8");
const saveAssertions = await readFile(path.join(root, "tests/fixtures/schema-upgrade/squad-save-assertions.sql"), "utf8");
const productionIndexes = `
alter table public.players drop constraint players_profixio_id_key;
alter table public.players drop constraint players_stupa_user_role_id_key;
create unique index players_profixio_id_key on public.players (profixio_id);
create unique index players_stupa_user_role_id_key on public.players (stupa_user_role_id)
  where stupa_user_role_id is not null;
`;

for (const [label, schema, failure, followupOnly] of [
  ["fresh rebuild", "", null],
  ["staging legacy snapshots, permissive save helper and editor formatting", legacy + legacySave + formatting + `
    drop index public.fantasy_gameweeks_stupa_stage_id_idx;
    drop index public.matches_stupa_stage_id_idx;
  `, null],
  ["production legacy snapshots, permissive save helper, formatting and identity indexes", legacy + legacySave + formatting + productionIndexes, null],
  ["staging after the first reconciliation still has the permissive save helper", legacySave, null, true],
  ["unexpected helper caller aborts without changes", legacy + `
    create function public.unexpected_snapshot_caller() returns void language plpgsql as $$
    begin perform public.snapshot_locked_squads_without_player_roster(); end; $$;
  `, "Unexpected caller"],
  ["unexpected index aborts and rolls back earlier DDL", legacy + formatting + productionIndexes + `
    drop index public.players_profixio_id_key;
    create index players_profixio_id_key on public.players (profixio_id);
  `, "Missing or unexpected player identity index"],
  ["multiline literals abort rather than changing a function's behavior", legacy + `
    do $$ declare body text; definition text; begin
      select prosrc, pg_get_functiondef(oid) into body, definition
      from pg_proc where oid = 'public.create_private_league(text)'::regprocedure;
      execute replace(definition, body, E'\r\n' || replace(body,
        'Leaderboard name cannot be empty.', E'Leaderboard name\r\ncannot be empty.'));
    end; $$;
  `, "Unexpected literal"],
  ["unreviewed save implementation aborts and rolls back both migrations", legacy + legacySave + `
    do $$ declare body text; definition text; begin
      select prosrc, pg_get_functiondef(oid) into body, definition
      from pg_proc where oid = 'public.save_my_fantasy_team_without_lineup_order(uuid,jsonb,text)'::regprocedure;
      execute replace(definition, body, replace(body,
        'if squad_cost > current_team_budget then', 'if squad_cost > current_team_budget / 2 then'));
    end; $$;
  `, "Unexpected squad-save helper definition"],
]) {
  // No linked database, API credentials, reset, or persisted fixture changes.
  // All cases use one connection; errors/disconnects also roll back the fixture.
  const caseStatements = followupOnly ? migrations[1] : statements;
  const sql = `begin;
    ${fixture}
    ${schema}
    select pg_temp.remember_state();
    ${failure ? `do $test$ begin
      begin
        execute $migration$${caseStatements}$migration$;
        raise exception 'Expected migration rejection';
      exception when others then
        if position('${failure}' in sqlerrm) = 0 then raise; end if;
      end;
      perform pg_temp.assert_unchanged(true);
    end; $test$;` : `${caseStatements}
      select pg_temp.assert_unchanged(false);
      ${saveAssertions}
      ${assertions}
      ${caseStatements}
      select pg_temp.assert_canonical_schema();`}
    rollback;`;
  const result = spawnSync("docker", ["exec", "-i", `supabase_db_${projectId}`,
    "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
  { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120000, env: developmentEnvironment() });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  console.log(`Schema upgrade passed: ${label}`);
}

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

// Reconstruct the exact original banner schema only inside rollback-only tests.
// Verify a populated conversion as well as duplicate-content rejection.
const originalBanners = await readFile(path.join(root, "supabase/migrations/20261026120000_homepage_banners.sql"), "utf8");
const competitionMigration = (await readFile(path.join(root,
  "supabase/migrations/20261031120000_gameweek_homepage_competitions.sql"), "utf8"))
  .replace(/^begin;$/m, "").replace(/^commit;$/m, "");
const bannerFixture = await readFile(path.join(root, "tests/fixtures/homepage-banner-upgrade.sql"), "utf8");
const publicCompetitionMigration = (await readFile(path.join(root,
  "supabase/migrations/20261101120000_public_competition_content.sql"), "utf8"))
  .replace(/^begin;$/m, "").replace(/^commit;$/m, "");
for (const duplicate of [null, "gameweek", "season"]) {
  const sql = `begin;
    update public.competition_publication set enabled = true where id;
    drop policy "Only approved rules for revealed competitions are readable" on public.competition_rules;
    drop policy "Revealed homepage competition artwork is readable" on storage.objects;
    drop function public.get_public_competition(uuid);
    drop function public.get_homepage_competitions();
    drop table public.homepage_banners;
    drop function public.homepage_gameweek_states();
    ${originalBanners}
    ${bannerFixture}
    ${duplicate ? `insert into public.homepage_banners (kind, gameweek_id, title, description)
      select kind, gameweek_id, 'Conflicting campaign', 'Preserve me' from public.homepage_banners
      where ${duplicate === "season" ? "kind = 'season'" : "title = 'Ready campaign'"};
      do $test$ begin
        begin
          execute $migration$${competitionMigration}$migration$;
          raise exception 'Expected duplicate rejection';
        exception when others then
          if position('Duplicate homepage competition content requires operator review' in sqlerrm) = 0 then raise; end if;
        end;
        if exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'homepage_banners' and column_name = 'content_ready') then
          raise exception 'Rejected migration did not roll back';
        end if;
        if (select count(*) from public.homepage_banners) <> 7 then
          raise exception 'Rejected migration changed content';
        end if;
      end; $test$;` : `${competitionMigration}
      do $test$ begin
        if exists (select 1 from banner_before old join public.homepage_banners b using (id)
          where (to_jsonb(old) - 'kind') <> (to_jsonb(b) - 'kind' - 'content_ready'))
          or (select count(*) from public.homepage_banners) <> 6 then
          raise exception 'Legacy content or publication settings changed';
        end if;
        if (select count(*) from public.homepage_banners where content_ready) <> 1
          or not (select content_ready from public.homepage_banners where title = 'Ready campaign') then
          raise exception 'Draft, scheduled, expired or teaser content was marked ready';
        end if;
        if exists (select 1 from public.homepage_banners where kind not in ('gameweek', 'season')) then
          raise exception 'Legacy kinds were not converted';
        end if;
      end; $test$;
      create temp table competition_before on commit drop as select * from public.homepage_banners;
      ${publicCompetitionMigration}
      do $test$ begin
        if exists (select 1 from competition_before old join public.homepage_banners b using (id)
          where to_jsonb(old) <> (to_jsonb(b) - array['prize_image_path', 'prize_image_alt',
            'prize_description', 'rules_markdown', 'eligibility_markdown', 'details_markdown']))
          or (select count(*) from public.homepage_banners) <> 6 then
          raise exception 'Public competition migration changed existing content';
        end if;
      end; $test$;`}
    rollback;`;
  const result = spawnSync("docker", ["exec", "-i", `supabase_db_${projectId}`,
    "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
  { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120000, env: developmentEnvironment() });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Homepage banner upgrade (${duplicate ?? "populated"}): ${result.stderr}`);
  console.log(`Homepage banner upgrade passed: ${duplicate ? `${duplicate} duplicate rejection and rollback` : "content preservation and safe readiness conversion"}`);
}

// Published terms and their references must remain stable across editorial updates.
const rulesValidation = await readFile(path.join(root, "tests/fixtures/competition-rules.sql"), "utf8");
const rulesResult = spawnSync("docker", ["exec", "-i", `supabase_db_${projectId}`,
  "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
{ input: rulesValidation, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120000, env: developmentEnvironment() });
if (rulesResult.error) throw rulesResult.error;
assert.equal(rulesResult.status, 0, `Competition rules validation: ${rulesResult.stderr}`);
console.log("Competition rules passed: approval, immutable history, automatic binding, kind isolation and anonymous RLS");

// A populated content cleanup must preserve unapproved legacy text privately;
// an oversized combination must roll back, never truncate or partially migrate.
const contentCleanup = (await readFile(path.join(root,
  "supabase/migrations/20261101170000_simplify_competition_content.sql"), "utf8"))
  .replace(/^begin;$/m, "").replace(/^commit;$/m, "");
for (const oversized of [false, true]) {
  const sql = `begin;
    update public.competition_publication set enabled = true where id;
    alter table public.homepage_banners add column rules_markdown text,
      add column eligibility_markdown text, add column cta_url text,
      add column sort_order integer not null default 0;
    drop index public.homepage_banners_publication_idx;
    create index homepage_banners_publication_idx on public.homepage_banners (kind, sort_order, publish_at desc, id) where published;
    insert into public.fantasy_gameweeks (id, stupa_stage_id, stupa_round_id, name, round_order, lock_at, unlock_at, first_match_starts_at, last_match_ends_at)
      values ('00000000-0000-0000-0000-000000004901', -1999999600, -1999999601, 'Cleanup upgrade', 4901, now() + interval '1 hour', now() + interval '2 days', now() + interval '2 hours', now() + interval '1 day');
    insert into public.homepage_banners (id, gameweek_id, content_ready, title, prize_description, rules_markdown, eligibility_markdown)
      values ('00000000-0000-0000-0000-000000004902', '00000000-0000-0000-0000-000000004901', true,
        'Preserved prize', 'Preserved description', ${oversized ? "repeat('a', 12000), repeat('b', 12000)" : "'Legacy rules text', 'Legacy eligibility text'"});
    ${oversized ? `do $test$ begin
      begin
        execute $cleanup$${contentCleanup}$cleanup$;
        raise exception 'Oversized legacy content was accepted';
      exception when check_violation then null; end;
      if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'homepage_banners' and column_name = 'eligibility_markdown')
        or exists (select 1 from public.competition_rules where title like 'Migrated draft:%') then
        raise exception 'Content cleanup failed to roll back'; end if;
      if (select length(rules_markdown) from public.homepage_banners where title = 'Preserved prize') <> 12000 then
        raise exception 'Rollback lost original legacy text'; end if;
    end; $test$;` : `${contentCleanup}
    do $test$ begin
      if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'homepage_banners'
        and column_name in ('rules_markdown', 'eligibility_markdown', 'cta_url', 'sort_order')) then
        raise exception 'Unused columns remain'; end if;
      if not exists (select 1 from public.homepage_banners where title = 'Preserved prize' and prize_description = 'Preserved description'
        and rules_version_id is null and content_ready) then raise exception 'Prize content or binding changed'; end if;
      if not exists (select 1 from public.competition_rules where approved_at is null
        and title = 'Migrated draft: banner 00000000-0000-0000-0000-000000004902'
        and body = E'Legacy rules:\\n\\nLegacy rules text\\n\\nLegacy eligibility:\\n\\nLegacy eligibility text') then
        raise exception 'Legacy terms were lost or approved'; end if;
    end; $test$;
    set local role anon;
    do $test$ begin
      if exists (select 1 from public.competition_rules where title like 'Migrated draft:%') then
        raise exception 'Migrated draft leaked'; end if;
      if (select rules_markdown from public.get_public_competition('00000000-0000-0000-0000-000000004901')) is not null then
        raise exception 'Legacy terms were published'; end if;
    end; $test$;`}
    rollback;`;
  const result = spawnSync("docker", ["exec", "-i", `supabase_db_${projectId}`,
    "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
  { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120000, env: developmentEnvironment() });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Competition content cleanup (${oversized ? "rollback" : "preservation"}): ${result.stderr}`);
  console.log(`Competition content cleanup passed: ${oversized ? "oversized-content rollback" : "private draft and prize preservation"}`);
}

# Database migrations and deployments

Database schema changes are versioned in `supabase/migrations/` and applied in
filename order by the Supabase CLI. The migration directory is the source of
truth; do not change staging or production directly.
Give every new migration a version later than the latest migration already
deployed to staging or production. An older filename added on a feature branch
will block the normal deploy even if it applies cleanly to a fresh local stack.

The old manually applied scripts are retained in `supabase/legacy/` for audit
history only. They must not be run again.

## Daily schema-change workflow

Use the local Docker stack for normal development. It has its own database,
users, data, and API keys; local changes never affect staging or production.

Before changing the schema, start the stack and confirm it is local:

```bash
npm run db:start
npx supabase status
```

The Project/API URL must be `http://127.0.0.1:54321`. If it is not, fix
`.env.local` before running the app or import scripts.

Create a timestamped migration, edit the generated SQL, then apply and lint it:

```bash
npm run db:new -- describe_the_change
npx supabase migration up --local
npm run db:lint
```

Test the affected behavior locally. Before finishing a schema change, rebuild
the local database and lint it to prove the migration history is reproducible:

```bash
npx supabase db reset --local
npm run db:lint
```

`db reset --local` deletes local data and Auth users. State that before running
it when local data may matter.

## Rebuild a populated local database

For a clean local database with the current player roster, 10 test accounts,
and synthetic gameweeks, run:

```bash
npm run dbsetup:local
```

This starts Supabase, runs `db reset --local`, imports players, creates the
accounts, and installs the synthetic gameweek fixture. It deletes existing
local data and Auth users, imports the committed player catalogue without upstream network access, and
does not import the real schedule or results. Fixture times are relative to the
command run and reopen at Stockholm midnight. Generated local accounts use the
password `test12`.

## Studio and seed data

Local Studio may be used for experimentation, but its changes are not versioned
automatically. Capture and review them before finishing:

```bash
npx supabase db diff --local -f describe_the_change
```

Migrations and `db diff` capture schema objects, not ordinary rows or Auth
users. If repeatable local data is needed, use only synthetic, non-sensitive
seed data.

Never run `supabase db reset --linked`: it resets the linked hosted database.
Likewise, leave `supabase db push` to the GitHub Actions deployment workflow
during normal development.

## Promote a tested migration

Before enabling hosted database workflows, verify the environment restrictions,
credential scopes and branch protections in the
[Phase A2 configuration and cutover guide](privileged-workflows-security.md).
Production deploy/status runs use `main` and the existing **Production**
environment; staging deploy/status runs use `develop` and **staging**. Results
processing remains separately bound to **production-results** and unattended.

Commit the new migration and open a pull request into `develop`. Pull requests
first rebuild and lint a clean local database in CI. After the PR is merged,
GitHub Actions applies the pending migration to staging.

To test the application against staging locally, use a dedicated terminal.
Next.js does not load `.env.staging.local` automatically:

```bash
set -a
source .env.staging.local
set +a
npm run dev
```

Do not use this terminal for normal local development or imports.

Test the application against staging, then promote the exact tested commit by
opening a pull request from `develop` into `main`. GitHub Actions applies
approved migrations to staging and production; it is the only normal path for
hosted schema changes.

Never edit an already deployed migration. Add a new migration that moves the
schema forward. Keep player, fixture and result imports in their existing
server-side jobs; migrations are for schema objects, policies, functions,
triggers, and small controlled reference-data changes.

## Reconcile the pre-baseline hosted schema

Migration `20261011120000_reconcile_legacy_snapshot_schema.sql` addresses the
legacy snapshot wrapper/helpers found in both hosted status reports. It restores
the baseline snapshot RPC in place, retaining its identity and the later
transfer-bank and lineup-order triggers. It removes only the redundant legacy
snapshot triggers/helpers, including the old administrative function callable
by API roles. The public Cron command remains `public.snapshot_locked_squads()`.
It does not invoke a snapshot/score/refresh job or change stored application
rows, prices, budgets, chips, squads, points, player identities, or Auth users.

The migration keeps the production stage indexes and adds them to other
environments. It adopts production's standalone license index as the baseline
UNIQUE constraint, and builds full role-ID uniqueness before replacing the old
partial index. Multiple NULL identifiers remain allowed. It normalizes CRLF and
outer whitespace on the baseline functions reported in the diffs while retaining
their live SQL bodies, signatures, security settings and grants. Unexpected
multiline/dollar/escape literals stop normalization for review.

All changes use one transaction, a five-second lock timeout and a thirty-second
statement timeout. Index/constraint work can briefly block table access; the
timeouts bound waits and statements, not total migration duration. Unexpected
index definitions, helper callers or dependent objects abort and roll back.
No `CASCADE`, migration-history repair, reset, old migration replay, or historical
rescoring is part of this correction. A timeout or dependency error needs review;
do not remove the safeguards to force a hosted deployment through.

`npm run check:all` also runs rollback-only upgrade tests on its disposable
stack. These cover a fresh rebuild and populated staging/production legacy
fixtures, schema convergence, preserved data and RPC identity, actual trusted
snapshot execution, incomplete squads, chips, lineup order, transfer history,
repeat calls and rejection/rollback paths. PR CI runs the same upgrade checks.
These fixtures model the reported objects; they are not copies of hosted data
and cannot rule out additional unreported dependencies.

Promote this correction only after these staging checks:

1. Merge the reviewed feature change into `develop`; let the normal staging
   deployment apply the new migration successfully.
2. Run **Check database migration status** on `develop` targeting staging.
   The check must show matching migration history, no pending migrations, and
   an empty public-schema diff. A replacement function still appearing after
   normalization may represent a substantive difference; review it instead of
   suppressing the check or overwriting its body blindly.
3. Verify staging sign-in, saved squads/captains, chips, private leagues and
   existing gameweek results. Confirm the normal snapshot job and results/scoring
   lifecycle succeed for staging before approving production promotion.
4. Confirm a recoverable production backup/restore point, then promote the exact
   tested `develop` commit to `main`. The production deployment applies the same
   migration, with conditional handling of production's identity indexes.
5. Run the corrected status check on `main` targeting production and verify the
   application. Stop promotion if staging has unexplained drift or failing checks.

The status workflow prints migration history and the dry-run plan before the
schema comparison, so drift does not hide those diagnostics. It explicitly
captures text SQL from CLI stdout; a nonempty diff or CLI failure fails the job.
The old `--output schema-diff.sql` invocation did not write a file in normal diff
mode, so its green result was not evidence of schema parity. A dry-run showing
"up to date" checks registered migration versions, not actual schema equality.

## Reconcile staging player and club UUIDs

If a hosted environment already has the same players under different UUIDs,
do not use the routine insert-only player migration generator: it correctly
stops on those identity conflicts. Add a reviewed forward migration that maps
the known old UUIDs to the committed production catalogue. Remap club
references and merge player references so current squads, locked squads,
results, statistics, snapshots and identity aliases continue to point at the
same people. Keep prices and `active` status from the reviewed catalogue.
The migration briefly suspends the current-squad club-limit trigger while
replacing player UUIDs, then restores it and verifies each team's per-club
selection counts. Foreign keys and uniqueness constraints stay enabled.

The one-time migration requires the reviewed legacy roster and clubs before
remapping staging. It seeds a clean local database from the catalogue. On a
populated database without the legacy UUIDs, it verifies the current players,
clubs, and committed identity mappings before doing nothing; unexpected data
aborts the migration. After it reaches staging, export a fresh staging
candidate and compare its players and clubs with `data/player-catalogue.json`
before promoting the exact tested commit to `main`. Do not reset a hosted
environment to solve a catalogue UUID mismatch.

## New player catalogue rows

New shared players are small controlled reference-data changes. After adding and
validating a player in `data/player-catalogue.json`, generate an insert-only data
migration for that explicit permanent UUID:

```bash
npm run import:players:dry
npm run test:imports
npm run generate:player-migration -- --player-id <new-player-uuid>
```

Review the generated SQL, then apply and test it locally:

```bash
npx supabase migration up --local
```

Commit the catalogue and migration together. The SQL preflights club, UUID,
SBTF-license, STUPA-role and external identity conflicts. It inserts missing
rows but does not update or delete an existing player, price, ownership row or
historical record. Promote it with the
same `develop` then `main` process as every other migration. Do not generate a
migration for the whole historical catalogue or run it directly against a
hosted project.

## Back up hosted application data

Before risky hosted database work, create a logical backup outside the
repository. Add `SUPABASE_DB_URL` to the matching ignored local env file:
`.env.production` for production and `.env.staging.local` for staging. Copy the
Postgres connection URL from the matching Supabase project's **Connect** panel.
Keep these URLs private; the env files are ignored by Git.

Then run the matching command:

```bash
npm run db:backup:production
npm run db:backup:staging
```

Each command checks that the database URL appears to match the project URL in
that env file, then writes role, schema, and data SQL files into a timestamped
folder under `/mnt/c/Users/gusta/OneDrive/fantasy-pingisligan-db-backups/production`
or `/mnt/c/Users/gusta/OneDrive/fantasy-pingisligan-db-backups/staging`. Keep
the OneDrive folders private, wait for syncing to finish, and periodically test
a restore against a separate project or local database. Never commit backup
files.

For an ad hoc target, `npm run db:backup -- "/path/to/private/folder"` still
prompts for a connection URL without displaying it.

The CLI's standard dump excludes Supabase-managed schemas such as `auth` and
`storage`; this procedure backs up application tables (including gameweek team
snapshots and their stored points), but does not back up login accounts or
Storage file objects. It also does not back up project settings, API keys, or
Edge Functions. Treat Auth recovery as a separate procedure.

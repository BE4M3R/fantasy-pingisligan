# Database migrations and deployments

Database schema changes are versioned in `supabase/migrations/` and applied in
filename order by the Supabase CLI. The migration directory is the source of
truth; do not change staging or production directly.

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

# Fantasy Pingisligan

Fantasy table-tennis app for Pingisligan, built with Next.js and Supabase.

## Start locally

Start Docker, install dependencies, and start local Supabase:

```bash
npm install
npm run db:start
npx supabase status
```

Create `.env.local` using the values printed by `npx supabase status`:

```dotenv
# API_URL
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
# PUBLISHABLE_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-local-publishable-key
# SERVICE_ROLE_KEY; required by imports and gameweek test commands
SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key
# Set manually
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Do not commit `.env.local` or its keys. Then start the app:

```bash
npm run dev
```

Open http://localhost:3000.

### Rebuild a populated local database

This starts local Supabase, deletes all local database data and Auth users,
rebuilds migrations, imports the committed player snapshot, creates 10 local
test accounts, and installs the synthetic gameweek fixture.

```bash
npm run dbsetup:local
```

The generated local accounts use the password `test12`. It does not import the
real schedule or results. The synthetic gameweeks use times relative to when
the command runs and Stockholm midnight for reopening.

The catalogue preserves stored prices and permanent UUIDs. Player setup needs
no upstream network access, and repeated imports never overwrite existing
prices. Rankings are optional; active players with prices remain selectable.

Verify the catalogue against production with a read-only candidate export:

```bash
npm run export:players:production-candidate
diff -u data/player-catalogue.json data/player-catalogue.production.json
```

This uses the uncommitted `.env.production`, selects production clubs, players
and stored identity aliases, and writes only the ignored candidate file. It does
not modify production or overwrite the committed catalogue.

An equivalent staging comparison is available when diagnosing environment drift:

```bash
npm run export:players:staging-candidate
diff -u data/player-catalogue.json data/player-catalogue.staging.json
```

The export reads `.env.staging.local` and writes the ignored
`data/player-catalogue.staging.json`. It does not modify staging or overwrite
the committed catalogue. Copy only reviewed changes into
`data/player-catalogue.json`.

For a new player, add one permanent UUID to the catalogue, calculate its price,
validate it, and generate the insert-only data migration that follows the normal
`develop` → staging → `main` → production path:

```bash
npm run calculate:player-price -- --ranking-points 2305 --world-ranking-position 98
npm run import:players:dry
npm run generate:player-migration -- --player-id <new-player-uuid>
```

## Checks

```bash
npm run lint
npm run build
npm run test:imports
```

## Database migrations

Create, apply, and lint a schema migration:

```bash
npm run db:new -- describe_the_change
npx supabase migration up --local
npm run db:lint
```

To verify the full migration history, run the following. It deletes local
database data and Auth users:

```bash
npx supabase db reset --local
npm run db:lint
```

Never run `supabase db push` or `supabase db reset --linked`. Hosted migrations
deploy through GitHub Actions.

## Feature branch to staging

Start from the current `develop` branch, then commit and push your feature:

```bash
git switch develop
git pull --ff-only
git switch -c feature/describe-the-change
git add path/to/changed-files
git commit -m "Describe the change"
git push -u origin feature/describe-the-change
```

Open a pull request from the feature branch into `develop`. After it is merged,
GitHub Actions deploys pending migrations to staging. Do not push feature work
directly to `main`.

## Data imports

These commands target local Supabase by default: each script loads `.env.local`.
Run them only from a terminal where `.env.staging.local` has not been sourced.
Imports need `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Run dry imports
before writing data:

```bash
npm run import:players:dry
npm run calculate:player-price -- --ranking-points 2305 --world-ranking-position 98
npm run import:schedule:dry
npm run import:results:dry
```

Run the real imports in this order:

```bash
npm run import:players
npm run import:schedule
npm run import:results
```

The results workflow checks every day at 00:07 Swedish time. On each day with
fixtures it also checks every 15 minutes at :07, :22, :37, and :52 from the
first match start until the day ends; gap days in a multi-day gameweek get only
the daily check. The 00:07 and manual runs refresh fixtures first. GitHub Actions
may delay runs.

Nightly schedule refreshes accept changed deadlines until the existing deadline
passes. After that point the gameweek's lock and unlock boundaries are frozen,
while individual fixture times and statuses still update. An existing fixture
also keeps its original gameweek if STUPA later moves or postpones it.

GitHub includes the exact triggering cron expression in
`github.event.schedule`. The workflow passes it to the cadence check as
`RESULTS_CRON`, so a delayed run still knows why it was started:

- `7 0 * * *` is the special daily 00:07 run. It always refreshes fixtures and
  imports results.
- `22,37,52 * * * *` covers :22, :37 and :52 in every hour.
- `7 1-23 * * *` covers :07 in hours 01–23; midnight :07 is already handled by
  the daily expression.
- `workflow_dispatch` is treated like the daily run.

For the 15-minute expressions, the cadence check reads at most one matching
fixture from Supabase. It proceeds only when a fixture in the configured stage
has started on the current Stockholm date. Otherwise the run stops before
installing dependencies or contacting STUPA.

The workflow uses `npm run import:results -- --complete-gameweek-refresh`:
STUPA import and scoring must succeed before the pending unlocked gameweek is
marked refreshed. Prices and budgets stay unchanged. Profixio is not called and
no price-refresh GitHub variable is required. See
[data imports](docs/data-imports.md) for catalogue maintenance and the separate
boundary for future explicit price updates.

To inspect the same scheduling decision against local synthetic fixtures without
writing data:

```bash
npm run check:results-refresh:local -- --stage-id -900001
npm run test:results-schedule
```

## Generate local test accounts

Generated local test users always use the password `test12`. Create 10 users
with completed squads:

```bash
npm run seed:local-accounts -- seed --count 10
```

If `db reset --local` removes the accounts, rerun the seed command; it recreates
them.

Inspect or remove only accounts created by this script:

```bash
npm run seed:local-accounts -- status
npm run seed:local-accounts -- cleanup --yes
```

## Local gameweek lifecycle test

The local database needs the fixture's clubs and players, and two completed
fantasy teams. The commands change local test data only.

```bash
npm run test:local -- cleanup
npm run test:local -- validate
npm run test:local -- setup
npm run test:local -- status gw1
npm run test:local -- lock gw1
npm run test:local -- status gw1
npm run test:local -- score gw1
npm run test:local -- status gw1
npm run test:local -- unlock gw1
npm run test:local -- status gw1
```

`unlock` moves past the scheduled unlock time, loads the available synthetic
results, verifies scoring, and clears that gameweek's refresh lock in the same
command. Reload the app afterward. Prices and budgets remain unchanged; failed
scoring leaves transfers closed. No separate refresh command is needed.

Clean up when finished:

```bash
npm run test:local -- cleanup
```

## Staging gameweek lifecycle test

`test:staging` reads `.env.staging.local` and requires `APP_ENV=staging` plus a
matching `STAGING_PROJECT_REF`. It changes staging test data. Use the same
commands as above, replacing `test:local` with `test:staging`.

To create staging test accounts, put `TEST_ACCOUNT_PASSWORD` in
`.env.staging.local`, then run `npm run seed:staging-accounts`.

To run the app against staging in a dedicated terminal:

```bash
set -a
source .env.staging.local
set +a
npm run dev
```

## Local gameweek lifecycle test
npm run test:staging -- cleanup
npm run test:staging -- validate
npm run test:staging -- setup
npm run test:staging -- status gw1
npm run test:staging -- lock gw1
npm run test:staging -- status gw1
npm run test:staging -- score gw1
npm run test:staging -- status gw1
npm run test:staging -- unlock gw1
npm run test:staging -- status gw1

## Further documentation

- [Database migrations](docs/database-migrations.md)
- [Gameweek lifecycle tests](docs/staging-testing.md)
- [Data imports](docs/data-imports.md)
- [Architecture](docs/architecture.md)
- [Design system](docs/design-system.md)

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
npm run test:unit
```

Run `npm run test:all` against local Supabase for authenticated game-rule tests
and browser smoke tests. See [automated testing](docs/automated-testing.md) for
setup, CI reports, and test isolation.

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

GitHub schedules one results workflow each night at 00:07 Swedish time. Supabase
Cron checks fixtures at :07, :22, :37, and :52 and starts a GitHub results run
only from the first match start until five hours after that day's last match
starts, including across midnight. Gap days in a multi-day gameweek get only
the nightly run after any prior day's window ends. Nightly and full manual runs
refresh fixtures first. GitHub Actions may delay scheduled runs.

Nightly schedule refreshes accept changed deadlines until the existing deadline
passes. After that point the gameweek's lock and unlock boundaries are frozen,
while individual fixture times and statuses still update. An existing fixture
also keeps its original gameweek if STUPA later moves or postpones it.

GitHub's only cron is `7 0 * * *` in `Europe/Stockholm`. Supabase Cron uses the
same database match-window rule as the read-only local and staging checks, then
dispatches the workflow with `kind=poll` during the window. The dispatched run
checks the rule again before installing dependencies or contacting STUPA.
Ordinary manual workflow runs use `kind=full` and refresh fixtures and results.

The production workflow uses `npm run import:results -- --complete-gameweek-refresh`:
STUPA import and scoring must succeed before the pending unlocked gameweek is
marked refreshed. Prices and budgets stay unchanged. Profixio is not called and
no price-refresh GitHub variable is required. See
[data imports](docs/data-imports.md) for catalogue maintenance and the separate
boundary for future explicit price updates.

To inspect the same scheduling decision against local synthetic fixtures without
writing data:

```bash
npm run check:results-refresh:local -- --stage-id -900001
npm run check:results-refresh:staging -- --at 2026-09-21T20:00:00+02:00
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

Staging uses the real fixture schedule and results, refreshed manually after
deploying `develop`:

```bash
npm run refresh:staging
npm run verify:staging
npm run seed:staging-accounts -- status
```

`refresh:staging` checks the target in `.env.staging.local`, imports fixtures,
then imports results, scores and completes an unlocked real gameweek. It prints
the real fixture, gameweek, score and transfer-lock status afterward and stops
if an import or verification step fails. `verify:staging` repeats that read-only
check without importing. If an older real round remains pending after unlock,
run `refresh:staging` again; each import completes one round. Keep the existing
`[TEST] Seedlag` teams as a stable baseline; do not reseed them for ordinary
checks, because seeding resets their current squads. Check the app's login,
teams, transfers, points and standings
against staging. No GitHub Actions job imports staging results automatically.

Run the synthetic lock/score/unlock sequence above against local Supabase.
`test:staging` changes staging test data and can lock transfers for everyone;
use it only for a short, deliberate smoke test and always clean it up.

To create staging test accounts, put `TEST_ACCOUNT_PASSWORD` in
`.env.staging.local`, then run `npm run seed:staging-accounts`.

To run the app against staging in a dedicated terminal:

```bash
set -a
source .env.staging.local
set +a
npm run dev
```

## Further documentation

- [Database migrations](docs/database-migrations.md)
- [Gameweek lifecycle tests](docs/staging-testing.md)
- [Data imports](docs/data-imports.md)
- [Architecture](docs/architecture.md)
- [Design system](docs/design-system.md)

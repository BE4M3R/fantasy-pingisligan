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
rebuilds migrations, imports current players, creates 10 local test accounts,
and installs the synthetic gameweek fixture. It needs network access for the
player import.

```bash
npm run dbsetup:local
```

The generated local accounts use the password `test12`. It does not import the
real schedule or results. The synthetic gameweeks use times relative to when
the command runs and Stockholm midnight for reopening.

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
npm run import:schedule:dry
npm run import:results:dry
```

Run the real imports in this order:

```bash
npm run import:players
npm run import:schedule
npm run import:results
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
npm run test:local -- refresh-prices gw1
npm run test:local -- status gw1
```

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

## Further documentation

- [Database migrations](docs/database-migrations.md)
- [Gameweek lifecycle tests](docs/staging-testing.md)
- [Data imports](docs/data-imports.md)
- [Architecture](docs/architecture.md)
- [Design system](docs/design-system.md)

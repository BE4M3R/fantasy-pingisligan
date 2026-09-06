# Fantasy Pingisligan

A Next.js fantasy table tennis app for the Pingisligan. Users can create
accounts with Supabase Auth, log in, and eventually build fantasy teams,
compete in leagues, and score points from real Pingisligan results.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth and Postgres
- Vercel-friendly deployment

## Supabase setup

Create a Supabase project, then add these values to `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Do not commit service role keys or other private tokens.

The database schema is managed by timestamped Supabase CLI migrations. Existing
staging and production projects require a one-time baseline; new projects can
apply the migration history directly. Follow the [database migration and
deployment guide](docs/database-migrations.md). Do not apply schema files
manually in a remote SQL Editor.

In Supabase Auth settings, add these redirect URLs for local development:

```text
http://localhost:3000/auth/callback
http://localhost:3000/auth/reset-password
```

For production, set `NEXT_PUBLIC_SITE_URL` to the deployed site URL in Vercel
and add the matching deployed callback URLs in Supabase.

## Getting Started

First, run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Useful routes:

- `/` public landing page
- `/signup` create account
- `/login` log in
- `/dashboard` protected app area with squad builder
- `/test-supabase` simple database smoke test

## Branch and release flow

`develop` is the staging branch and `main` is the production branch. Start work
from `develop`, use a feature branch, and open a pull request back into
`develop`. After testing the resulting staging deployment, promote the same
changes with a pull request from `develop` into `main`.

```text
feature branch -> develop -> staging -> main -> production
```

Database migrations deploy automatically when they reach `develop` or `main`.
Application deployments remain handled by Vercel. Avoid pushing feature work
directly to `main`.

## Local testing

Install dependencies, then run the local application checks from the repository
root:

```bash
npm install
npm run test:imports
npm run lint
npm run build
```

`test:imports` runs the Node.js tests for importer and player-identity logic.
Lint checks the TypeScript and React code, while the production build also
catches compilation and type errors.

To validate the database migrations locally, Docker must be running and the
Supabase CLI dependencies must be installed. Start the local Supabase stack,
recreate its database from the migration history, and lint the resulting
schema:

```bash
npm run db:start
npm run db:reset
npm run db:lint
npm run db:stop
```

`db:reset` deletes and recreates only the local Supabase database.

### Staging gameweek lifecycle tests

The staging harness runs from your local terminal and reads and writes the
configured staging Supabase project. Before the first run, create
`.env.staging.local` and ensure staging has at least two complete fantasy teams.
Follow the [staging gameweek test guide](docs/staging-testing.md) for that
one-time setup.

#### Start a clean testing session

Run these commands from the repository root. They remove an earlier set of
synthetic gameweeks, validate the test fixture, install a fresh set, and show
their initial state:

```bash
npm run test:staging -- cleanup
npm run test:staging -- validate
npm run test:staging -- setup
npm run test:staging -- status
```

To inspect the website during the test, start the app against staging in a
second terminal:

```bash
set -a
source .env.staging.local
set +a
npm run dev
```

#### Run a complete gameweek lifecycle

The following recipe takes Gameweek 1 through locking, scoring, unlocking, and
the final price refresh. The `status` checks make it easy to confirm each state
transition:

```bash
npm run test:staging -- status gw1
npm run test:staging -- lock gw1
npm run test:staging -- status gw1
npm run test:staging -- score gw1
npm run test:staging -- status gw1
npm run test:staging -- unlock gw1
npm run test:staging -- status gw1
npm run test:staging -- refresh-prices gw1
npm run test:staging -- status gw1
```

Repeat the lifecycle with `gw2`, `gw3`, or `gw4` as needed. Use `lock-cron`
instead of `lock` when specifically testing the scheduled snapshot job; the
full guide explains the required wait and checks.

#### End the testing session

Remove all synthetic gameweeks after testing:

```bash
npm run test:staging -- cleanup
```

The harness only accepts a staging environment and uses reserved test IDs, but
it still changes remote staging data. It does not remove staging accounts,
fantasy squads, leagues, imported players, or real match data.

## Developer documentation

- [Repository guide](docs/README.md) — where code lives and where to start
- [Architecture](docs/architecture.md) — application boundaries and request flows
- [Design system](docs/design-system.md) — brand colors, UI tokens and usage rules
- [Database](docs/database.md) — main tables and relationships
- [Database migrations](docs/database-migrations.md) — local changes, staging and production deployments
- [Data imports](docs/data-imports.md) — importer order, operation and troubleshooting
- [Updating a checkout](docs/updating.md) — pull, migrate and verify safely

## Data imports

Keep Profixio scraping and result imports server-side. Good places for that
later are a GitHub Actions scheduled job, a Supabase Edge Function, or a
server-only script. Do not put scraping logic in browser/client components.

### Player imports

To import players from the first Profixio men ranking page, add a private
service role key locally in `.env.local` or in your cron environment:

```bash
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Then run:

```bash
npm run import:players
```

The script reads club search strings from `clubs.txt`, takes up to 10 first-page
ranking matches per club, and stores prices as whole fantasy currency values
using `(max(2250, ranking_points) - 2200) * 100000`. If the `Placering`
column contains a world ranking such as `WR02`, the rounded surcharge
`50000000 / sqrt(world_rank)` is added to that player's price (`WR02` is
treated as world rank `2`).

The nightly workflow imports available results and then refreshes player prices from the
pending gameweek's locked snapshot. Price changes preserve a completed team's
unspent cash and instead increase or decrease its total team value. Transfers
reopen only after both workflow steps succeed. A plain `npm run import:players`
is reserved for preseason; in-season refreshes use `--after-unlock`.

The baselined schema includes the importer, permanent-identity, inactive-player,
and gameweek club-snapshot database support. Current and historical licenses
therefore resolve to one permanent player.
Players outside the latest selected club rosters are retained at their last
price but marked inactive; existing owners may keep them while new owners
cannot select them. Locked player-club rosters keep historical fixture-win
bonuses stable when old gameweeks are recalculated after a transfer.

To test parsing without writing to Supabase:

```bash
npm run import:players:dry
```

### Schedule imports

The schedule importer reads rounds, teams, dates and match times from Stupa's
stage-based group-match endpoint. It also creates fantasy gameweeks and their
transfer lock windows.

The importer defaults to the upcoming Pingisligan stage (`5727`). Run:

```bash
npm run import:schedule
```

To inspect another stage without writing to Supabase:

```bash
STUPA_STAGE_ID=4521 npm run import:schedule:dry
```

### Result imports

To import scored Stupa submatches, calculate player points, and refresh fantasy
team totals, first ensure the database migration status is current, then run:

```bash
npm run import:results
```

The importer defaults to the upcoming Pingisligan stage (`5727`). Override it
with `STUPA_STAGE_ID`, for example to inspect another completed league:

```bash
STUPA_STAGE_ID=4521 npm run import:results:dry
```

See [Data imports](docs/data-imports.md) for the required import order, Windows
commands, rerun behavior and troubleshooting.

Stupa's player `meta_data.license_id` and `user_role_id` are matched through the
player's historical external identities. Unmatched players are retained in the
raw result tables and reported instead of being silently discarded. Conflicting
license and role mappings stop the import. Each successful import idempotently
recalculates all gameweeks affected by the imported results.

## Deploy

When deploying to Vercel, add these environment variables in the Vercel project:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Also add the deployed callback URL to Supabase Auth redirect URLs:

```text
https://your-domain.vercel.app/auth/callback
```

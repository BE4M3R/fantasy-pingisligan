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
```

Do not commit service role keys or other private tokens.

In the Supabase SQL editor, run:

```sql
-- contents of supabase/schema.sql
```

That creates starter tables for profiles, clubs, players, fantasy teams,
leagues, matches and player stats, plus row-level security policies.

In Supabase Auth settings, add these redirect URLs for local development:

```text
http://localhost:3000/auth/callback
```

Add the matching deployed Vercel callback URL when you deploy.

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

## Developer documentation

- [Repository guide](docs/README.md) — where code lives and where to start
- [Architecture](docs/architecture.md) — application boundaries and request flows
- [Database](docs/database.md) — main tables and relationships
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
using `(max(2250, ranking_points) - 2200) * 100000`.

For existing Supabase databases created before the importer, run
`supabase/player-import-migration.sql` in the Supabase SQL editor. It is safe to
run again after the squad builder update; it also normalizes fantasy team
budgets to the same whole-number currency unit as player prices.

To test parsing without writing to Supabase:

```bash
npm run import:players:dry
```

### Schedule imports

The schedule importer reads rounds, teams, dates and match times from Stupa's
stage-based group-match endpoint. It also creates fantasy gameweeks and their
transfer lock windows.

For an existing Supabase database, first run
`supabase/stupa-stage-schedule-migration.sql` in the Supabase SQL editor. The
importer defaults to the upcoming Pingisligan stage (`5727`). Then run:

```bash
npm run import:schedule
```

To inspect another stage without writing to Supabase:

```bash
STUPA_STAGE_ID=4521 npm run import:schedule:dry
```

### Result imports

To import scored Stupa submatches and per-player set results, first run
`supabase/stupa-results-migration.sql` in the Supabase SQL editor, then run:

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

Stupa's player `meta_data.license_id` is matched to the existing Profixio ID.
Unmatched players are retained in the raw result tables and reported instead of
being silently discarded. Fantasy points are not assigned by this importer.

## Deploy

When deploying to Vercel, add these environment variables in the Vercel project:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Also add the deployed callback URL to Supabase Auth redirect URLs:

```text
https://your-domain.vercel.app/auth/callback
```

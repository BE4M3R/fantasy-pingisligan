# AGENTS.md

## Project
This repository is `fantasy-pingisligan`, a Next.js app for a fantasy game based on Pingisligan, the highest Swedish table tennis division.

## Architecture and task map
Next.js App Router, TypeScript and Tailwind CSS; Supabase Auth/Postgres; Vercel
hosting. GitHub Actions imports STUPA schedules/results; players use the
committed catalogue. Supabase stores users, players, clubs, matches, fantasy
teams, leagues and points.

| Task / code location | Read first |
| --- | --- |
| Routes in `app/(default)/`, shared dashboard UI/actions in `app/dashboard/`, endpoints in `app/api/` | [Architecture](docs/architecture.md) |
| Auth/session clients in `lib/supabase/`, session refresh in `proxy.ts` | [Architecture: trust boundaries](docs/architecture.md#trust-boundaries) |
| Visual/responsive changes; tokens in `app/globals.css` | [Design system](docs/design-system.md) |
| Schema, RLS, SQL functions in `supabase/migrations/` | [Migrations](docs/database-migrations.md), [database](docs/database.md) |
| Squad, chips, scoring, transfer lifecycle | [Game rules](docs/game-rules.md), [architecture](docs/architecture.md); verify against implementation (rules doc is marked draft) |
| Server-only imports in `scripts/`, catalogue in `data/`, jobs in `.github/workflows/` | [Data imports](docs/data-imports.md) |
| Home fixtures/streams; query/loading performance | [Home matches](docs/home-matches.md), [performance inventory](docs/performance-inventory.md) |
| Test selection, local fixtures, browser inspection, PR preparation | [Automated testing](docs/automated-testing.md) |
| Advance a local gameweek to a scenario/state; harness in `scripts/staging-gameweek-test.mjs` | [Local state controls](docs/staging-testing.md#local-state-controls) |

Start local setup in [README.md](README.md); use [docs/README.md](docs/README.md)
for the full documentation index and [updating.md](docs/updating.md) for checkout updates.

## Implementation rules
- Design and implement for many concurrent users: always consider efficient page loading, including appropriate caching where possible, minimizing database queries and payload sizes, and avoiding unnecessary client-side work.
- Use TypeScript and simple components. Prefer Server Components for database
  reads; use Client Components for interactivity. Keep UI clean and mobile-friendly.
- Keep data imports server-side; never call or scrape Profixio.
- Player prices are explicit stored values, independent of optional legacy rankings.

## Local and production flow parity
- Local, staging and production must follow the same application rules and
  lifecycle. Treat local testing as verification of production behavior.
- Test fixtures, credentials, scheduling and simulated time may differ by
  environment; business rules, operation order, failure handling and resulting
  state must match. Local tests must not bypass required production steps or
  require extra manual steps to complete the equivalent flow.
- For gameweeks, results must be persisted and scoring must succeed before
  transfers reopen after the unlock time. Local `unlock` performs this flow
  using synthetic results; production performs it through the results job.
  Neither flow automatically changes player prices or team budgets, and a
  failed results/scoring step must leave transfers closed.
- Results polling uses Europe/Stockholm: a daily 00:07 check, plus checks
  every 15 minutes from the first fixture start on each playing day until five
  hours after that day's last fixture start, including across midnight. GitHub
  schedules the nightly run; Supabase Cron checks the match window and dispatches
  GitHub only when due. Use individual fixture dates,
  including every playing day of a multi-day gameweek; do not poll throughout
  gap days. Keep the shared database cadence check, local tests and production
  workflow aligned.
- When changing a flow, update its local test harness, production workflow,
  relevant tests and documentation together. Reuse shared implementation where
  practical to prevent the environments from drifting apart.

## Environment variables
Local development uses `.env.local`, and it must point to the local Supabase
stack shown by `npx supabase status` (`http://127.0.0.1:54321` by default).
Use `.env.staging.local` only for explicit staging commands. Keep production
values in Vercel and GitHub environment secrets, not in `.env.local`.

Expected public variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Never expose in logs, screenshots, reports or commits:
- Supabase service role key
- Vercel tokens
- Any private API keys

## Database changes
- Treat `supabase/migrations/` as the source of truth for the database schema.
- Read `docs/database-migrations.md` before changing the schema.
- Develop and test schema changes only against the local Supabase stack.
- Create a new migration for every schema change; never edit a deployed
  migration or mutate a hosted database directly.
- Never run linked/remote reset or push commands. GitHub Actions deploys
  approved migrations.
- `supabase/legacy/` is archived SQL; never reapply it.

## Workflow
- Use the branch-promotion order `feature branch` → `develop` → `main`.
  Open feature pull requests into `develop`; do not push feature work directly
  to `main`. After staging has been tested, promote the exact tested `develop`
  commit with a pull request into `main`.
- For schema changes, merging into `develop` deploys pending migrations to
  staging. Merging the tested `develop` commit into `main` deploys those
  migrations to production. Do not deploy a migration to production before it
  has been tested on staging.

- Inspect `git status`, the relevant implementation and mapped docs first;
  explain the plan briefly. Prefer focused changes, show diffs before large
  changes, and ask for input when material uncertainty remains.
- Preserve unrelated work. Do not discard changes, reset populated local data,
  commit, push, create PRs or deploy unless the user has authorized that action.
- Default to local resources. Staging commands and hosted reads require an
  explicit staging/production task; a dry-run label alone does not make an
  importer offline or safe for a hosted target.

## Validation and repository skills
- Choose checks from [the test-selection table](docs/automated-testing.md#choose-checks-by-change).
  Run `npm run lint` for relevant code changes and `npm run test:unit` for code
  changes. Auth, database and lifecycle changes need local functional coverage.
- Use `npm run test:all` for isolated local database/browser validation; do not
  reset your populated stack to make tests pass. Start `npm run dev` only when
  needed for rendered verification; Playwright can manage its own server.
- For local scenario requests, inspect `npm run test:local -- status` first.
  Use the [state controls](docs/staging-testing.md#local-state-controls) to
  prepare, lock, reach kickoff, step singles/doubles, score or unlock. Preserve
  accounts/squads; do not improvise SQL updates or reset a populated stack.
- Repository skills live in `.agents/skills/`:
  - [$verify-ui](.agents/skills/verify-ui/SKILL.md): mobile/desktop browser checks
    with captured screenshots that Codex must open and inspect.
  - [$prepare-pr](.agents/skills/prepare-pr/SKILL.md): review, choose validation,
    inspect migrations/credentials and draft a PR targeting `develop`.
    Invocation alone does not authorize committing, pushing or creating a PR.
- Inspect the final diff, including new files. Report checks performed, failures
  or checks not run, migrations created, and any Vercel variables the user must
  add manually. Never claim visual verification from assertions alone.

## Visual design
- Read `docs/design-system.md` before making visual or color changes.
- Treat the `--pf-*` variables in `app/globals.css` as the source of truth for colors.
- Use tokens according to their documented roles instead of adding raw hex values or sampling colors from the raster logo.
- If the palette changes, update both `app/globals.css` and `docs/design-system.md` in the same change.

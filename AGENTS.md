# AGENTS.md

## Project
This repository is `fantasy-pingisligan`, a Next.js app for a fantasy game based on Pingisligan, the highest Swedish table tennis division.

## Tech stack
- Next.js with App Router
- TypeScript
- Tailwind CSS
- Supabase for database and authentication
- Vercel for hosting
- GitHub Actions imports STUPA schedules/results; players use the committed catalogue

## Important architecture
- Frontend/app code lives in this repo.
- Supabase is used for auth, users, players, clubs, matches, fantasy teams, leagues and points.
- Design and implement for many concurrent users: always consider efficient page loading, including appropriate caching where possible, minimizing database queries and payload sizes, and avoiding unnecessary client-side work.
- Keep data imports server-side; never call or scrape Profixio.
- Player prices are explicit stored values, independent of optional legacy rankings.
- Do not expose or commit secret keys.

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
- Results polling uses Europe/Stockholm: a daily midnight check, plus checks
  every 30 minutes after the first fixture starts on each playing day until
  midnight. Use individual fixture dates, including every playing day of a
  multi-day gameweek; do not poll throughout gap days. Keep the shared cadence
  check and its local tests aligned with the production workflow.
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

Never expose or commit:
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

## Workflow
- Use the branch-promotion order `feature branch` → `develop` → `main`.
  Open feature pull requests into `develop`; do not push feature work directly
  to `main`. After staging has been tested, promote the exact tested `develop`
  commit with a pull request into `main`.
- For schema changes, merging into `develop` deploys pending migrations to
  staging. Merging the tested `develop` commit into `main` deploys those
  migrations to production. Do not deploy a migration to production before it
  has been tested on staging.

Before making changes:
- Inspect existing files first.
- Explain the plan briefly.
- Prefer small, focused changes.
- Show diffs before large changes.
- Ask user for input if uncertain

After making code changes:
- Run `npm run lint` if relevant.
- Run `npm run dev` only when needed to verify behavior.
- Mention migrations created and validation performed.
- Mention any Vercel environment variables that the user must add manually.

## Coding style
- Use TypeScript.
- Keep components simple.
- Prefer server components for database reads when possible.
- Use client components only when interactivity is needed.
- Keep UI clean and mobile-friendly.

## Visual design
- Read `docs/design-system.md` before making visual or color changes.
- Treat the `--pf-*` variables in `app/globals.css` as the source of truth for colors.
- Use tokens according to their documented roles instead of adding raw hex values or sampling colors from the raster logo.
- If the palette changes, update both `app/globals.css` and `docs/design-system.md` in the same change.

# AGENTS.md

## Project
This repository is `fantasy-pingisligan`, a Next.js app for a fantasy game based on Pingisligan, the highest Swedish table tennis division.

## Mandatory Git workflow

- Start all development from `develop` on a dedicated feature/fix/docs branch.
  Codex may develop, test, commit and push that branch, and create PRs targeting
  `develop`, unless the current request limits those actions.
- **Codex must NEVER merge PRs.** Only the human operator may approve/confirm
  and merge PRs into `develop` or merge PRs into `main`.
- Production releases happen exclusively through `develop` → `main` PRs after
  staging verification, promoting the exact tested `develop` commit. Codex may
  prepare such a release PR only when explicitly requested; the human merges it.
- Never push directly to `develop` or `main`, create a feature → `main` PR,
  bypass branch protections, or trigger production deployments as a substitute
  for this release workflow.

### Pull request CI verification

- After pushing a feature branch and creating a PR into `develop`, run
  `gh pr checks <PR>` and check `CI gate` and all relevant test results.
- If checks are pending, use `gh pr checks <PR> --watch` when appropriate.
- If checks fail, inspect the failure logs with
  `gh run view <run-id> --log-failed`, fix the issue, commit/push the fix on the
  feature branch, and verify CI again.
- When CI succeeds, report the PR URL, test results and readiness for human
  review. **Never merge the PR, even when every check passes.**
- Never bypass CI checks. If GitHub authentication fails, stop and report it;
  never use privileged credentials as a fallback.

## Git authentication

- Always use the repository's configured HTTPS remote and restricted GitHub CLI
  authentication on every platform.
- Never switch to SSH, use an SSH URL, or access/use the existing SSH private
  key for this repository, including as an authentication fallback.
- If HTTPS authentication fails, stop and report the issue. Never fall back to
  another privileged GitHub credential or change authentication to work around it.

## Supabase access policy

- Default to local Supabase on Windows, macOS and Linux; WSL2 is optional.
  `npm run dev` and normal development/test commands must use local Supabase.
  Never fall back to staging or production when local services are unavailable.
- Staging is an explicit opt-in development target. Authorized developers may
  run the local Next.js app against staging with `npm run dev:staging`, read and
  write staging data, and deliberately create test accounts, players, fantasy
  teams and other fixtures. Staging-only credentials may remain locally
  accessible in ignored `.env.staging.local`; they need not share the production
  operator boundary. Credential availability alone is not authorization.
- Staging commands use a consistent `:staging` suffix and load configuration
  from `.env.staging.local` without inherited credential/target overrides.
  The developer is responsible for that file containing staging credentials.
  Preserve the existing lightweight URL/project-ref and app-env checks; do not
  add a separate staging identity registry or production credential lookups.
  See [development commands](docs/local-development-security.md#phase-b3-development-commands).
  Never run staging seeding, resets, cleanup or lifecycle changes automatically
  during ordinary development. Hosted schema changes still use GitHub Actions.
- For explicitly authorized production database diagnostics, use **only**
  `supabase-production-readonly`, with `read_only=true`, the production
  `project_ref`, `features=database` and scoped `PF_SUPABASE_RO_TOKEN`
  authentication. Run only read-only queries and minimize access to personal
  user data.
  If MCP authentication fails or the server is unavailable, stop and report it;
  never fall back to connection strings, service-role keys, privileged Supabase
  CLI credentials or other database connections.
- Never write directly to production from local development. Production
  migrations and imports must use the existing authorized GitHub Actions
  workflows. Dispatching them or causing other indirect production writes
  requires explicit authorization; diagnostic authorization does not grant it.
- Do not read, print or expose secrets unnecessarily, or store production tokens
  in repository files. MCP settings and credentials are developer-specific and
  optional; see [safe production access](docs/codex-production-access.md).
  These instructions and repository guards do not provide credential isolation.

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

Read [portable setup and credential separation](docs/local-development-security.md)
for target selection, operator boundaries and automation prerequisites. Use guarded
npm entry points for local Next/Supabase/Playwright. Do not bypass a filename-only
Next preflight failure by renaming credential files, setting VERCEL, or calling Next
directly. Report the blocker and leave manual credential isolation to the developer.
Never treat repository guards or environment filtering as OS credential isolation.

Local development uses `.env.local`, and it must point to the local Supabase
stack shown by `npx supabase status` (`http://127.0.0.1:54321` by default).
Use `.env.staging.local` only for explicit staging commands. Keep production
write credentials out of the everyday development identity, including its files,
inherited environment and cached authentication. Keep deployed application/job
credentials in Vercel and GitHub environment secrets as appropriate; separate
production operator stores must be inaccessible to everyday development.

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
- For schema changes, merging into `develop` deploys pending migrations to
  staging. Merging the tested `develop` commit into `main` deploys those
  migrations to production. Do not deploy a migration to production before it
  has been tested on staging.

- Inspect `git status`, the relevant implementation and mapped docs first;
  explain the plan briefly. Prefer focused changes, show diffs before large
  changes, and ask for input when material uncertainty remains.
- Preserve unrelated work. Do not discard changes, reset populated local data,
  or deploy unless the user has authorized that action. Feature commits, pushes
  and PR creation follow the mandatory Git workflow and the current request's scope.
- Staging access requires an explicit staging task; a dry-run label alone does
  not make an importer offline or safe for a hosted target.

## Validation and repository skills
- [Automated testing](docs/automated-testing.md) is the authoritative guide for
  test selection, commands, isolation and rendered inspection. Run `npm run check`
  by default before handing off code changes; use `npm run check:all` when its
  [test-selection table](docs/automated-testing.md#choose-checks-by-change) calls
  for comprehensive coverage. `check:all` includes `check`; avoid repeating it.
  Focused commands remain available during iteration.
- For documentation/instruction-only changes, check references, commands, skill
  frontmatter and the final diff; skip application validation unless executable
  code or behavior also changes.
- Keep validation local and use the guide's disposable runners for database
  tests. Never substitute staging/production or reset populated local data to
  make checks pass. Start `npm run dev` only when needed for rendered verification;
  Playwright can manage its own server.
- For local scenario requests, inspect `npm run test:local -- status` first.
  Use the [state controls](docs/staging-testing.md#local-state-controls) to
  prepare, lock, reach kickoff, step singles/doubles, score or unlock. Preserve
  accounts/squads; do not improvise SQL updates or reset a populated stack.
- Repository skills live in `.agents/skills/`:
  - [$verify-ui](.agents/skills/verify-ui/SKILL.md): mobile/desktop browser checks
    with captured screenshots that Codex must open and inspect.
  - [$prepare-pr](.agents/skills/prepare-pr/SKILL.md): review, choose validation,
    inspect migrations/credentials and draft a PR targeting `develop`.
    Follow the Git permissions above; preparation-only requests remain local.
- Inspect the final diff, including new files. Report checks performed, failures
  or checks not run, migrations created, and any Vercel variables the user must
  add manually. Never claim visual verification from assertions alone.

## Visual design
- Read `docs/design-system.md` before making visual or color changes.
- Treat the `--pf-*` variables in `app/globals.css` as the source of truth for colors.
- Use tokens according to their documented roles instead of adding raw hex values or sampling colors from the raster logo.
- If the palette changes, update both `app/globals.css` and `docs/design-system.md` in the same change.

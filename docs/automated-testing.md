# Automated tests

Test source lives in `tests/unit/`, `tests/functional/`, and `tests/browser/`.
Generated reports and failure artifacts live in the matching folders under
`test-results/`, which Git ignores:

| Suite | Results after running |
| --- | --- |
| Unit | `test-results/unit/results.xml` |
| Functional | `test-results/functional/results.xml` |
| Browser | `test-results/browser/results.xml`, `report/`, and `artifacts/` |

Each command also prints named passing and failing cases in the terminal.
Open `test-results/browser/report/index.html` for the browser report.

## Choose checks by change

Use the affected behavior to select checks; `package.json` defines the commands.
For code changes, start with `npm run lint` and `npm run test:unit`, then add
the relevant checks below. Focused commands speed up iteration; they do not
replace the full suites when several areas are affected.

| Change | Additional validation |
| --- | --- |
| Docs / instruction-only skills | Check links, paths, commands and final diff; validate skill frontmatter with the skill-creator validator when available. App build/database/browser execution is unnecessary unless behavior or executable helpers change. |
| Components, styling, responsive layout | Render affected routes using the [UI inspection procedure](#rendered-ui-inspection) and `$verify-ui`; run `npm run build` for code changes. |
| Routes, Server Actions, auth, API responses | `npm run build` and `npm run test:all`; inspect `tests/functional/security.test.mjs` for authorization regressions. |
| Squad eligibility, club limits | `npm run test:squad`, then `npm run test:functional`; include browser journeys if editing/saving behavior changes. |
| Scoring, snapshots, chips, transfer lock/unlock | `npm run test:scoring`, `npm run test:gameweek-refresh`, then `npm run test:all`; use [local state controls](staging-testing.md#local-state-controls) for timing/UI inspection. |
| STUPA schedule, polling cadence, Stockholm dates | `npm run test:results-schedule`, `npm run test:gameweek-refresh`; `npm run test:functional` for SQL/lifecycle integration. Use synthetic fixtures; dry imports can still contact upstream services. |
| Player catalogue, identity, price or migration generator | `npm run test:imports`; new data migrations also need the migration procedure below. |
| Database schema, RLS, SQL functions/triggers | Follow [database migrations](database-migrations.md): new forward migration, local apply/rebuild and `npm run db:lint`; `npm run test:all` for affected database and browser behavior. |
| Query size, caching, leaderboard performance | `npm run test:performance`, `npm run build`; affected functional/browser journeys plus the [performance inventory](performance-inventory.md). |
| Home fixtures/streams | Unit suite includes match-summary tests; `npm run test:functional` and the `home-matches.spec.mjs` browser journey; inspect loading, refresh-failure and live states. |

Add regression coverage when behavior changes. Do not add tests that only check
documentation wording or repeat implementation details. Report the commands
actually run, their results, and any coverage that remains unverified.

## Local suites and isolation

Run the fast rules and importer tests after any code change:

```bash
npm run test:unit
```

Run the full local check with one command:

```bash
npm run test:all
```

`test:all` runs the unit suite, starts a disposable Supabase stack from the
committed migrations on free local ports, runs authenticated database flows,
then runs the Chromium journeys in a Playwright Docker container. It stops and
removes the temporary stack afterward, even if a test fails. Docker must be
running; the first run may download the Playwright image. Your usual local
Supabase stack and `.env.local` are left untouched. The browser run uses a
separate temporary Next build directory, so an existing `npm run dev` session
can keep running.

`test:all` does not run ESLint, a production build or database lint; run
`npm run lint`, `npm run build` and `npm run db:lint` separately when selected
above. The database lint command targets your usual local stack, so apply the
new migrations there first according to the migration guide. A populated local
reset is destructive and needs authorization; use disposable tests for ordinary
regression checks.

`npm run test:functional` starts and removes its own clean disposable Supabase
stack, without changing your usual local database. CI uses
`test:functional:db` against the clean stack it has already started; that
internal command refuses to run when teams or gameweeks already exist.
For direct `test:e2e` runs on the host, install Chromium and its dependencies with
`npx playwright install --with-deps chromium`. CI does this automatically.

The suite runner uses Node's `--experimental-test-isolation=none`; use Node 24
as in CI. Prefer the wrapper commands over invoking functional test files
directly. Never point test configuration at a hosted Supabase project.

The unit suite includes `gameweek-steps.test.mjs` for individual event ordering,
multi-day/DST timing and local-only CLI guards. The functional suite's matching
file runs kickoff and incremental singles/doubles against real local Postgres,
checks partial points, golden doubles, failure/retry, delayed results and normal
unlock, and verifies that locked selections, prices and budgets remain unchanged. Both
files are discovered by the existing local and PR CI suite runners; production
results polling and deployment configuration do not need changes for these
synthetic time controls.

The functional tests create unique synthetic clubs, players, gameweeks, and an
Auth user, then remove only those records. They call the same save, snapshot,
scoring, and completion functions as the app and results job. The browser suite
uses the same fixture helper and checks sign-in, squad transfers and swaps,
captain and chip actions, results, private league creation and joining, and
navigation through a team's locked gameweek lineups, chip status and scores. No hosted Supabase project or STUPA
request is used.
The functional suite also completes two consecutive gameweeks for two managers,
including a transfer between weeks, and checks player scores, per-week team
scores, preserved first-week scores, and cumulative private league standings.

`tests/functional/security.test.mjs` exercises ordinary authenticated requests:
budget updates and invalid starting budgets are rejected, including during a
lock; default team creation, renaming, onboarding, and trusted budget adjustments
still work. Invalid captaincy preserves the previous squad and chip state, and
private save functions remain inaccessible. Run it with the functional suite:
`npm run test:functional`. Existing scoring cases cover historical snapshots
and automatic captain substitution.
The security suite also denies anonymous and authenticated calls to
administrative RPCs, including a player merge that would otherwise replace an
affordable owned player with an unaffordable one. Trusted merges remain usable.

The browser league journey checks per-week lineups, chip status, scores, player points breakdowns and cumulative standings.
The isolated stack is necessary because the production snapshot function
processes every team in an active gameweek. No local database reset is needed.

## Rendered UI inspection

The repository skill `$verify-ui` uses this procedure and the
[design system](design-system.md#responsive-layout-and-interaction).
Passing browser assertions alone does not establish that a layout looks correct.

### Choose the local target

- `playwright.config.ts` uses Chromium, one worker and
  `http://127.0.0.1:3100` by default (`TEST_APP_PORT` overrides the port). It starts
  Next with webpack automatically; do not start a second server on that port.
- For database-backed journeys, prefer `npm run test:all`. Its disposable stack,
  local credentials, matching Playwright Docker image and separate Next output
  directory avoid touching your normal local data or dev session. Do not run
  fixture-backed suites concurrently against the same stack.
- A direct `npm run test:e2e` uses the host browser and current local environment.
  Before launching, verify the effective Supabase URL (including shell overrides)
  matches the local stack shown by `npx supabase status`. Check only the URL;
  do not print keys or dump env files. Do not reuse a server with an unknown target.
- The existing authenticated browser journeys call `createFixture()` from
  `tests/functional/fixture.mjs`. It requires a clean local database with no
  teams or gameweeks, even though cleanup removes only its own records. Use the
  disposable runner instead of resetting a populated stack. For read-only
  inspection of a populated local app, use an existing local test account;
  keep fixture-backed specs out of that run.

### Capture and inspect

Adapt an existing journey or temporarily add a focused `*.spec.mjs` in
`tests/browser/`, which the current config discovers. Use existing login,
fixture and cleanup helpers; preserve `try/finally` or `afterAll` cleanup.
Keep review-only instrumentation out of the final diff unless it provides
useful regression coverage. A minimal public-page capture looks like this:

```js
import { expect, test } from "@playwright/test";

test("login visual review", async ({ page }, testInfo) => {
  for (const viewport of [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const screenshot = testInfo.outputPath(`login-ready-${viewport.width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`login-ready-${viewport.width}`, {
      path: screenshot, contentType: "image/png",
    });
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    )).toBe(true);
  }
});
```

For a review spec named `ui-review.spec.mjs`, a direct, already verified local
target can run just that file with `npm run test:e2e -- ui-review.spec.mjs`.
For authenticated fixture-backed reviews, the disposable `npm run test:all`
discovers it automatically. `npm run test:e2e -- --list` lists tests without
starting the app or connecting to a database.

Capture the affected page and interactive states at mobile and desktop sizes;
add the narrowest supported width and widths around affected breakpoints.
Use a viewport screenshot as well as full-page capture when fixed navigation,
sticky content or dialogs are involved. Wait for specific UI readiness and
fonts/images, rather than arbitrary sleeps or `networkidle` on polling pages.
To see loading states reliably, delay the affected local API with Playwright
routing, capture while the request is held, then release it and check the loaded
state. Fulfill an error/empty response separately when relevant; restore routes
afterward. These mocks exercise presentation, not scoring or lifecycle rules.

Open every screenshot used as evidence with Codex's image-viewing tool (or an
available image viewer). Inspect text clipping/wrapping, spacing, token roles,
cards, touch targets, overlays, scrollable regions and navigation. A screenshot
file's existence, DOM snapshot or overflow assertion is insufficient. A page
can have no document overflow and still clip a child or hide a dialog action.
If images cannot be viewed, report visual review as incomplete.

Store images under `test-results/browser/` (ignored), preferably with
`testInfo.outputPath()` and attachments as above. Include route, state and
viewport in names. Inspect/copy evidence before another run overwrites the
artifacts directory. Never capture secrets, tokens or real user data. Report
routes/states, viewport sizes, commands, screenshot paths, observed defects
and any untested cases. Recheck affected states after a fix. The current config
only auto-captures failures and traces on first retry; successful visual review
requires explicit screenshots. Viewport resizing covers layout, not all mobile
browser/touch behavior; use a Playwright mobile device context when that matters.

## Prepare a pull request

Use `$prepare-pr` for a local review and a draft title/body. Compare both branch
commits (`git diff develop...HEAD`) and uncommitted work (`git diff` and
`git diff --cached`); inspect untracked files explicitly. Check that local
`develop` is the intended base; if it is missing or stale, report that limitation
instead of silently fetching or switching branches. Feature PRs target
`develop`; promotion of a tested `develop` commit to `main` is a separate task.

Select tests from the table above and inspect the complete intended diff for
migration edits, authorization changes, credentials and unrelated artifacts.
Never print a suspected secret in the review; identify the file/location and
remediate it within the authorized scope. `.gitignore` does not protect secrets
added to tracked source, SQL, fixtures or screenshots. New migrations must be
forward-only and locally validated according to the migration guide; hosted
access is unnecessary for preparation.

Draft a concise title and body covering the problem, resulting behavior,
validation (including checks not run), migrations and required manual Vercel
variables. Keep draft files outside the tracked tree. Do not commit, push,
create a PR or deploy unless separately authorized. Preparation remains useful
offline; report missing tools or failed checks without claiming readiness.

## CI and reports

On every pull request to `develop` and `main`, GitHub runs two checks in
parallel: `code-and-unit` and `functional-and-browser`. The latter starts a
fresh local Supabase stack from migrations, lints the database, builds the app,
and runs the functional and browser suites. Both checks must pass before merge
when configured as required branch-protection checks. The Actions log prints
each named case; the job summary lists pass/fail counts and every case. Download
the JUnit results and Playwright HTML report from the job artifacts to inspect
failures and traces.

For manual local scenarios use the
[local state controls](staging-testing.md#local-state-controls), including kickoff
and one-result stepping. The same guide documents separately authorized staging
verification; those commands are not used as the pull request gate.

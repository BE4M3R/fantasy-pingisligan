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

`npm run test:functional` starts and removes its own clean disposable Supabase
stack, without changing your usual local database. CI uses
`test:functional:db` against the clean stack it has already started; that
internal command refuses to run when teams or gameweeks already exist.
For direct `test:e2e` runs on the host, install Chromium and its dependencies with
`npx playwright install --with-deps chromium`. CI does this automatically.

The functional tests create unique synthetic clubs, players, gameweeks, and an
Auth user, then remove only those records. They call the same save, snapshot,
scoring, and completion functions as the app and results job. The browser suite
uses the same fixture helper and checks sign-in, squad transfers and swaps,
captain and chip actions, results, private league creation and joining, and
navigation through a team's gameweek scores. No hosted Supabase project or STUPA
request is used.
The functional suite also completes two consecutive gameweeks for two managers,
including a transfer between weeks, and checks player scores, per-week team
scores, preserved first-week scores, and cumulative private league standings.
The browser league journey checks both per-week scores and cumulative standings.
The isolated stack is necessary because the production snapshot function
processes every team in an active gameweek. No local database reset is needed.

On every pull request to `develop` and `main`, GitHub runs two checks in
parallel: `code-and-unit` and `functional-and-browser`. The latter starts a
fresh local Supabase stack from migrations, lints the database, builds the app,
and runs the functional and browser suites. Both checks must pass before merge
when configured as required branch-protection checks. The Actions log prints
each named case; the job summary lists pass/fail counts and every case. Download
the JUnit results and Playwright HTML report from the job artifacts to inspect
failures and traces.

The interactive staging lifecycle commands in [staging-testing.md](staging-testing.md)
remain available for manual staging verification. They are not used as the pull
request gate.

# Gameweek lifecycle tests

## Intended use of staging

Keep staging on the same migrations, player UUIDs, application rules, fixture
schedule and results/scoring lifecycle as production. It has separate users,
teams and results state; it is not a copy of production's user database. After
deploying `develop`, manually refresh real STUPA stage `5727` in staging with
`npm run refresh:staging`. This imports the schedule, then results, scores and
completes an unlocked gameweek. See
[Data imports](data-imports.md#results-refresh-and-transfer-reopening) for the
shared cadence and completion rules.

Use the synthetic gameweek harness routinely against local Supabase. Running
`test:staging -- setup` inserts real rows into staging's global gameweek table;
once they lock, they close staging transfers for every user until each test
round is completed or the test fixture is cleaned up. The scheduled STUPA job
does not score synthetic stage `-900001`. Use staging synthetic rounds only for
a short end-to-end smoke test, finish them with `lock`, `score`, and `unlock`,
then run `npm run test:staging -- cleanup` when the test is finished.

Keep the existing marked `[TEST] Seedlag` accounts and their squads in staging
as a stable smoke-test baseline. Check them with
`npm run seed:staging-accounts -- status`; do not routinely rerun `seed`, which
resets their current squads. After a staging deployment, verify sign-in, team
and player selection, the current transfer window, and points/standings for a
completed real gameweek. Use local synthetic rounds for repeatable lock, score,
and unlock tests. Staging has its own test users and teams; do not copy
production users or teams into it.

There is no staging results GitHub Actions job. `refresh:staging` reads
`.env.staging.local` and checks `APP_ENV=staging`, the project URL and ref, and
the real stage ID before writing. It stops on a failed schedule or results
import. It then checks real stage fixtures, the last completed round's locked
squads and scores, any overdue round, and the transfer lock. Run
`npm run verify:staging` for the same read-only check at any time. A pending
unlocked real round needs another `refresh:staging` run; each run completes one
round. `test:staging -- status` reports synthetic rounds only. Check login,
squads, points, and standings in the staging app as well.
Production still uses its scheduled GitHub Actions job.

When the revised scoring migrations reach staging, the backfill migration
rescores every player result and locked team in previously scored gameweeks,
including GW1. Check a completed GW1 in the staging app: the result breakdown
should show the revised singles and doubles points, and the same team's GW1
score should agree across its squad, progress, league standings and leaderboard.
Check another locked team to
confirm the change applies beyond one account. The migration stops if an
already scored team lacks its snapshot or if the number of rescored teams does
not match the locked snapshots. Repeat these checks in production after
the tested `develop` commit is promoted to `main`.

The gameweek lifecycle harness reads its schedule and results from
[`test-data/staging-gameweeks.json`](../test-data/staging-gameweeks.json). The
default file contains four synthetic gameweeks covering all seven Pingisligan
clubs. Each round has two fixtures on its first Stockholm date and one on
the following date, with one club on a bye. The first two fixtures kick off
together; the third starts at the same local time the next day, including
daylight-saving changes. Gameweeks start three days apart so their transfer-lock windows do not overlap,
even when fixtures finish after midnight. It uses reserved
negative Stupa identifiers and never changes imported current-season matches.

The harness requires at least two completed fantasy teams with valid six-player
squads in the selected database.

## Generate test accounts and squads

The account seeder creates 20 confirmed Auth users by default. Every generated
user gets a completed fantasy team with four starters, two bench players, and
one captain. Squads are varied between accounts and respect both the SEK 100m
budget and the maximum of two players per club.

Local generated accounts always use the password `test12`. For staging, add a
shared password with at least eight characters to `.env.staging.local`:

```dotenv
TEST_ACCOUNT_PASSWORD=choose-a-test-only-password
```

Then seed the accounts. Choose the target explicitly:

```bash
npm run seed:local-accounts
npm run seed:staging-accounts
```

Use `--count` to choose another number, or inspect the generated accounts:

```bash
npm run seed:local-accounts -- seed --count 20
npm run seed:local-accounts -- status
```

The generated addresses are `fantasy-squad-test-01@example.com` and upwards.
They carry a private Auth metadata marker so the script can safely distinguish
them from manually registered accounts. Re-running the seed repairs only these
marked accounts and resets their current squads. It never changes other Auth
users, including the manually registered accounts listed below.

Delete only accounts carrying the seeder's marker, together with their
cascading fantasy data, by explicitly confirming cleanup:

```bash
npm run seed:local-accounts -- cleanup --yes
```

The service-role key and test password must remain only in the ignored
environment files.

## Safety configuration

Add the staging project reference to `.env.staging.local`. It is the first part
of the project URL:

```dotenv
APP_ENV=staging
STAGING_PROJECT_REF=your-staging-project-ref
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The command reads `.env.staging.local` directly. It stops unless `APP_ENV` is
exactly `staging` and the Supabase hostname exactly matches
`STAGING_PROJECT_REF`.

To use another versioned fixture file, add a project-relative path:

```dotenv
STAGING_TEST_DATA_FILE=test-data/my-staging-gameweeks.json
```

Never put Supabase keys in a JSON fixture.

## Run against local Supabase

The harness supports local and staging targets, selected explicitly by command.
For local testing, add these values to `.env.local` (using the service-role key
from `npx supabase status`):

```dotenv
SUPABASE_SERVICE_ROLE_KEY=your-local-secret-key
```

The local URL must remain `http://127.0.0.1:54321`. Start Supabase, then run
the same lifecycle commands using `test:local`:

```bash
npm run db:start
npm run test:local -- cleanup
npm run test:local -- setup
npm run test:local -- lock gw1
npm run test:local -- score gw1
npm run test:local -- unlock gw1
```

The selected database must already contain the clubs and active players named
in the fixture, plus two completed fantasy teams with valid squads. For a clean
local database, run the player import first and create the test teams locally.

`test:staging` remains a staging-only shortcut. For scripts or automation, use
the explicit command: `npm run test:gameweek -- --env local|staging <action> [gameweek]`.

## Local state controls

Use this section when asking Codex to put the local app in a scenario. First
confirm the app uses the local Supabase URL from `.env.local`, then inspect
`npm run test:local -- status`. The harness reads `.env.local` directly; never
substitute staging commands for a local scenario. `npm run test:local -- help`
lists the controls without loading credentials or connecting to a database.

The fixture's clubs/players and at least two complete teams must already exist
for the normal lifecycle. Follow the setup section above when missing. Preserve
existing accounts and squads; `dbsetup:*` resets the entire populated local
database and requires explicit authorization. `setup` refuses to overwrite
installed synthetic rounds. These controls move forward; to revisit a snapshotted
pre-deadline state, choose a fresh round or explicitly clean up/reinstall only
the synthetic test stage after agreeing to discard its history.

All commands below use `npm run test:local -- <action> [gameweek]`:

| Desired state / task | Action | Effect / prerequisite |
| --- | --- | --- |
| Discover commands | `help` | Offline command list. |
| Inspect current state | `status` or `status gw1` | Transfer lock, timestamps, snapshots, result counts, next singles/doubles match and whether a failed step needs retry. |
| Validate scenario | `validate` | Check JSON, local clubs/players and memberships without writes. |
| Install fixture rounds | `setup` | Install configured synthetic rounds after local catalogue/accounts exist. |
| Install a one-team demo | `setup-demo` | Demo setup; see the README scoring demo. |
| Update unstarted fixture dates | `reschedule` | Only before snapshots, results or refresh completion; keeps squads/accounts. |
| Open a test transfer window | `prepare gw1` | Make an unsnapshotted round next, with a 30-minute transfer window. Reload before selecting chips/saving. |
| Lock and snapshot immediately | `lock gw1` | Close transfers and call the production snapshot function. |
| Test Cron snapshot scheduling | `lock-cron gw1` | Close transfers; wait for the real five-minute local Cron job and inspect status before proceeding. |
| Reach first fixture kickoff | `kickoff gw1` | Requires a locked synthetic round with snapshots and no results; move its first start to now without scoring. Local only. |
| Complete one singles/doubles match | `next-match gw1` | After kickoff, advance to the next available individual result and verify cumulative scores. Local only. |
| Score all available results | `score gw1` | Bulk import all results available through this round and verify points/idempotency; use when intermediate states are unnecessary. |
| Complete and reopen transfers | `unlock gw1` | Pass unlock time, import available synthetic results, verify scoring, then complete refresh. Other locked rounds can still block transfers. |
| Run the full scoring demo | `run` | Complete and verify all configured rounds; may require fresh demo setup. |
| Remove synthetic test history | `cleanup gw1` or `cleanup` | Delete the chosen synthetic round or stage; keeps users, live squads, imported players and real fixtures. |

`refresh-prices` remains a separate budget-trigger regression command, described
below; it is not a normal lifecycle step. Never use it to reopen transfers.

### Step through individual results

Once your squad and chip selection are ready:

```bash
npm run test:local -- lock gw1
npm run test:local -- kickoff gw1
npm run test:local -- status gw1
npm run test:local -- next-match gw1
npm run test:local -- status gw1
```

Repeat `next-match gw1` for each singles or doubles result you want to reveal,
reloading the app between steps. Stop at any intermediate state. When finished,
use `unlock gw1` to run the normal results/scoring/completion flow. You can also
switch to `score gw1` to import all currently available results at once.
Do not run `lock` again to rewind a round that already has results.

Each step upserts exactly one individual result and its player rows, then uses
the same database scoring function and independent point/idempotency checks as
bulk scoring. A club fixture remains in progress with no declared winner until
its final configured individual match; club-win and clincher bonuses therefore
appear when that fixture finishes. Live points, sweep bonuses and automatic
substitutions reflect the current production calculation on the available
results and may change as later players appear. Golden doubles retain STUPA's
reset match order while being stepped last within their fixture.

The JSON has fixture kickoff times and durations, but no individual match times.
For this simulation, individual completions are spaced evenly over each
fixture's duration. The command shifts the selected round's stored timeline
backward so the next event has just occurred; it does not change the machine
clock or add an application clock override. It keeps fixture durations and
elapsed gaps between playing days, recalculates unlock at Stockholm midnight
after the final fixture, and leaves other gameweeks, locked squad selections, player prices
and budgets alone. This timing is local test data, not a new production rule.

Simultaneous fixtures start together. Their individual events are interleaved by
simulated completion time; ties use fixture order in the JSON. Each invocation
still reveals only one singles/doubles result. Events on later playing days
are reached automatically without waiting through the gap. Use `status` to see
which individual match will be processed next.

The default GW1 fixture intentionally withholds one club fixture until GW2 via
`resultAvailableFromGameweek`. `next-match gw1` skips those results; the existing
`score gw2` flow imports them later against the original GW1 snapshots. Once all
available matches are scored, another `next-match` does nothing and reports any
deferred results. Use a reviewed custom fixture file without a delayed-result
field if the scenario requires every match to be available in GW1.

A failed write or scoring check leaves transfers closed. The individual result
keeps a private test-payload pending marker until verification succeeds; retry
`next-match` to finish that same result before revealing another. Do not run
state-changing harness commands concurrently against the same round. `kickoff`
is harmless to repeat before results exist; it refuses to restart a round with
results. Completed/refreshed rounds cannot be stepped again.

Example requests for Codex:

```text
Put local GW1 at kickoff with no results. Preserve my users and squads.
Advance local GW1 by one singles or doubles result, verify points, and stop.
Show local GW1's next individual match and whether transfers remain locked.
Finish local GW1 through unlock, then prepare GW2 so I can test transfers.
```

## Check automatic results timing locally

The production cadence is a daily 00:07 check plus checks every 15
minutes at :07, :22, :37, and :52 from the first match start on each playing
day until five hours after the last match start, including across midnight.
Supabase Cron dispatches the match-window GitHub runs in production. Use its
read-only database rule against local synthetic fixtures or staging real fixtures:

```bash
npm run check:results-refresh:local -- --stage-id -900001
npm run check:results-refresh:local -- --stage-id -900001 --at 2026-09-21T20:00:00+02:00
npm run check:results-refresh:local -- --daily
npm run check:results-refresh:staging -- --at 2026-09-21T20:00:00+02:00
npm run test:results-schedule
```

`--at` requires an explicit timezone and simulates the check time only. It does
not change fixture times or write data. The output shows the checked instant in
both UTC and Stockholm time; `shouldRun` says whether a results import is due,
while `refreshSchedule` says whether it would also import fixtures. The daily
check always reports due;
interval checks report due only during that Swedish date's match window.
Tests cover playing days separated by gaps, winter/summer time and daylight
saving transitions. Continue using `score` and `unlock` for actual synthetic
scoring. Supabase Cron provides the production match-window timer; there is no
local background GitHub polling process. Staging runs the same Cron check
without a GitHub dispatch token; refresh staging results manually as described
above.

## Run the app against staging

Next.js does not load `.env.staging.local` automatically. In Bash, export the
variables from that file before starting the development server:

```bash
set -a
source .env.staging.local
set +a
npm run dev
```

## Test accounts

The following accounts already exist in the staging environment:

| Account | Username | Password |
| --- | --- | --- |
| 1 | `test_staging@gmail.com` | `test_staging` |
| 2 | `test_staging_2@gmail.com` | `test_staging_2` |

## Local synthetic lifecycle: JSON format

The following lifecycle commands target local Supabase. To run a deliberate,
short staging smoke test instead, replace `test:local` with `test:staging` and
clean up the synthetic gameweeks immediately afterward. Never leave synthetic
rounds installed while using staging for real-data checks.

The root contains a reserved `stageId` and one or more gameweeks:

```json
{
  "version": 1,
  "stageId": -900001,
  "gameweeks": []
}
```

Each gameweek defines a stable command key, its displayed order, a relative
initial start time, and one or more club fixtures:

```json
{
  "key": "gw1",
  "name": "[TEST] Scoring Gameweek 1",
  "roundOrder": 9001,
  "startsAfterHours": 3,
  "fixtures": []
}
```

To update existing local scoring gameweeks without resetting accounts or squads:

```bash
npm run test:local -- reschedule
```

This applies the current fixture schedule only when every installed scoring
round is still scheduled, without snapshots or completed refreshes. It keeps
the first round's start, updates later round dates, and moves each unlock to
Stockholm midnight after that round's final fixture. Setup uses the same
schedule automatically. Whole days in `startsAfterMinutes` follow the Stockholm
calendar; `1440` means the same local time the following date.

`setup` creates every configured gameweek. `startsAfterHours` is relative to
the setup time and must leave at least two hours before play. Later lifecycle
`lock` and `unlock` move only the selected gameweek through their lifecycle.
The `unlock` command moves all fixtures into the past, then moves past the scheduled unlock time, imports available
synthetic results, checks player/team totals and repeated scoring, then marks
only the selected gameweek refreshed—all in one command. It preserves prices,
budgets and fixture times during scoring and makes no STUPA request. Failures
leave transfers closed; retry `unlock` after correcting the failure. A repeat
after successful completion does nothing. Other locked gameweeks still keep
transfers closed.
`score` loads every result available up to the selected gameweek and refreshes
the affected current and previous gameweeks.

A club fixture explicitly lists its clubs and available lineup players:

```json
{
  "key": "eslov-halmstad",
  "startsAfterMinutes": 0,
  "durationMinutes": 120,
  "home": {
    "club": "Eslövs AI BTK",
    "players": ["Truls Möregårdh", "Vladislav Ursu", "Hugo Jobs"]
  },
  "away": {
    "club": "Halmstad BTK",
    "players": ["Kristian Karlsson", "Mattias Karlsson", "Noa Dahlström"]
  },
  "winner": "home",
  "matches": []
}
```

Club and player names are matched case-insensitively against active local
records. Every player must belong to the configured club. `winner` controls the
club-fixture bonus and can be `"home"`, `"away"`, or `null`; only players listed
in at least one singles or doubles match for the winning side receive the bonus.

Singles and doubles list the participating players and set score:

```json
{
  "type": "singles",
  "homePlayers": ["Truls Möregårdh"],
  "awayPlayers": ["Kristian Karlsson"],
  "result": { "homeSets": 3, "awaySets": 1 }
}
```

Use two names per side for doubles. A walkover omits the set score:

```json
{
  "type": "singles",
  "homePlayers": ["Vladislav Ursu"],
  "awayPlayers": ["Kristian Karlsson"],
  "result": { "walkover": true, "winner": "home" }
}
```

For a deciding golden doubles, append a doubles match as the fixture's final
`matches` entry and set `"isGoldenMatch": true`. The harness stores its STUPA
match order as `1`, as the real importer does, while scoring it as the final
played match for the fixture clincher bonus.

The script generates all reserved database identifiers; do not add Stupa IDs
to the JSON.

To simulate a postponed or late-reported club fixture, set the optional
`resultAvailableFromGameweek` field:

```json
{
  "key": "halmstad-rekord-late",
  "resultAvailableFromGameweek": "gw2"
}
```

The fixture still belongs to its original gameweek and therefore uses that
gameweek's locked squad snapshots. It is omitted by `score gw1`, then imported
and included in the recalculation when `score gw2` runs.

## Validate and install

Validate the JSON structure, clubs, player names, and club memberships without
writing test data:

```bash
npm run test:local -- validate
```

Remove any previous harness version, then install all configured gameweeks:

```bash
npm run test:local -- cleanup
npm run test:local -- setup
npm run test:local -- status
```

`cleanup` removes only rows using the configured reserved stage ID. Imported
players, users, fantasy squads, leagues, and real stage data remain.

## Test Gameweek 1

First prepare the test round as the dashboard's next gameweek:

```bash
npm run test:local -- prepare gw1
```

Reload the local website and verify the transfer deadline belongs to **[TEST]
Scoring Gameweek 1** before selecting a chip or saving squad changes. This is
important: the dashboard can otherwise show an earlier imported gameweek.
A chip confirmed for that real round remains reserved for it and does not affect
the synthetic test's scores.

`prepare` opens a 30-minute test transfer window ahead of every other upcoming
gameweek. It only moves a synthetic test round that has no snapshots, then the
normal `lock` command closes that window and creates the exact same snapshot
used by production.

To test the actual five-minute Supabase Cron scheduler:

```bash
npm run test:local -- lock-cron gw1
sleep 360
npm run test:local -- status gw1
```

The snapshot count must equal the number of fantasy teams with a complete
four-starter, two-bench squad at the deadline. You can also inspect the local
Supabase cron job history.
Snapshots retain the squad order selected by each manager; that locked order
sets automatic-substitution and replacement-captain priority.

For a faster snapshot-function test that bypasses the scheduler, use:

```bash
npm run test:local -- lock gw1
```

With either path, verify immediately after locking that squad, captain, and
chip changes are blocked. The direct `lock` command also verifies that every
selected test-gameweek chip was copied to its locked snapshot. Then score,
inspect, and complete the gameweek:

```bash
npm run test:local -- score gw1
npm run test:local -- status gw1
npm run test:local -- unlock gw1
npm run test:local -- status gw1
```

The scoring action prints every configured individual match, independently
calculates expected player and fantasy-team totals, compares them with
Supabase, and runs the database calculation twice to check idempotency. The
default data initially stores 16 GW1 player-result rows because its third
fixture is configured to arrive with GW2.

After `unlock` succeeds, reload the squad page. Transfers reopen if no other
gameweek is locked, and any chip locked for that test gameweek must now show as
**Used**. Repeat this with Bench Boost and Wildcard as well as Triple Captain.
No separate refresh command or local background job is needed. Use `status` to
identify any other locked rounds if transfers remain closed. Production still
imports and scores STUPA results automatically before clearing a pending round;
it never reprices players.

The optional `refresh-prices` regression command remains available only to
test the generic budget trigger for future explicit repricing against a
separately prepared pending unlocked round (normal `unlock` already completes
its round). It temporarily adds SEK 1m to a locked-squad player, verifies owners' budget changes, restores
prices and budgets, and marks the round refreshed. It is not part of the normal
local test lifecycle or production results workflow.

## Test Gameweek 2

Keep Gameweek 1 installed. Prepare Gameweek 2 before changing local squads or
selecting a different chip, so the dashboard attaches the change to the test
round rather than a real imported gameweek. Then run the next lifecycle:

```bash
npm run test:local -- prepare gw2
npm run test:local -- lock-cron gw2
sleep 360
npm run test:local -- status gw2
npm run test:local -- score gw2
npm run test:local -- status gw1
npm run test:local -- unlock gw2
```

After `score gw2`, GW1 has 24 player-result rows. Its delayed fixture has been
added and GW1 points have been recalculated against the unchanged GW1 squad
snapshot. This also allows Progress, cumulative leaderboards, free-transfer
rollover, transfer penalties, and one-use chips to be inspected across
gameweeks.

`score gw2` also moves GW2's first fixture into the past, so GW2 immediately
appears in league gameweek history, its imported points are included in league
totals. The home-page gameweek card shows **GW Live** as soon as the squad locks,
including before `score gw2`, and keeps that label until transfers reopen after
results and scoring complete. While transfers are available it shows
**GW Open**. A configured future gameweek remains absent from league history
and contributes no leaderboard points until its first fixture starts.

## Test Gameweeks 3 and 4

Repeat the same lifecycle, changing squads or chips between deadlines when
needed:

```bash
npm run test:local -- prepare gw3
npm run test:local -- lock gw3
npm run test:local -- score gw3
npm run test:local -- unlock gw3

npm run test:local -- prepare gw4
npm run test:local -- lock gw4
npm run test:local -- score gw4
npm run test:local -- unlock gw4
```

Each score run revisits every earlier gameweek whose configured results are
available by that point.

## Status and cleanup

Show every configured gameweek or only one key:

```bash
npm run test:local -- status
npm run test:local -- status gw1
```

Remove one gameweek or the entire synthetic stage:

```bash
npm run test:local -- cleanup gw1
npm run test:local -- cleanup
```

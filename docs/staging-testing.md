# Staging gameweek tests

The staging lifecycle harness reads its schedule and results from
[`test-data/staging-gameweeks.json`](../test-data/staging-gameweeks.json). The
default file contains two synthetic gameweeks. It uses reserved negative Stupa
identifiers and never changes imported current-season matches.

The harness requires at least two completed staging fantasy teams with valid
six-player squads.

## Safety configuration

Add the staging project reference to `.env.staging.local`. It is the first part
of the project URL:

```dotenv
APP_ENV=staging
STAGING_PROJECT_REF=your-staging-project-ref
```

The command reads `.env.staging.local` directly. It stops unless `APP_ENV` is
exactly `staging` and the Supabase hostname exactly matches
`STAGING_PROJECT_REF`.

To use another versioned fixture file, add a project-relative path:

```dotenv
STAGING_TEST_DATA_FILE=test-data/my-staging-gameweeks.json
```

Never put Supabase keys in a JSON fixture.

## JSON format

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

`setup` creates every configured gameweek. `startsAfterHours` is relative to
the setup time and must leave at least two hours before play. Later lifecycle
commands move only the selected gameweek through lock, play, and completion.

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

Club and player names are matched case-insensitively against active staging
records. Every player must belong to the configured club. `winner` controls the
club-fixture bonus and can be `"home"`, `"away"`, or `null`. An optional
`correctionWinner` changes it when the `correct` action runs.

Singles and doubles list the participating players and set score:

```json
{
  "type": "singles",
  "homePlayers": ["Truls Möregårdh"],
  "awayPlayers": ["Kristian Karlsson"],
  "result": { "homeSets": 3, "awaySets": 1 },
  "correction": { "homeSets": 1, "awaySets": 3 }
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

`correction` is optional. When present, `correct GAMEWEEK_KEY` replaces the
initial result with it. The script generates all reserved database identifiers;
do not add Stupa IDs to the JSON.

## Validate and install

Validate the JSON structure, clubs, player names, and club memberships without
writing test data:

```bash
npm run test:staging -- validate
```

Remove any previous harness version, then install all configured gameweeks:

```bash
npm run test:staging -- cleanup
npm run test:staging -- setup
npm run test:staging -- status
```

`cleanup` removes only rows using the configured reserved stage ID. Imported
players, users, fantasy squads, leagues, and real stage data remain.

## Test Gameweek 1

Before locking, open the website and verify Gameweek 9001 and its `[TEST]`
fixture. Optionally select a chip and save squad changes.

To test the actual five-minute Supabase Cron scheduler:

```bash
npm run test:staging -- lock-cron gw1
sleep 360
npm run test:staging -- status gw1
```

The snapshot count must equal the number of completed fantasy teams that
existed at the deadline. You can also inspect **Integrations > Cron > Jobs >
snapshot-locked-squads > History** in Supabase.

For a faster snapshot-function test that bypasses the scheduler, use:

```bash
npm run test:staging -- lock gw1
```

With either path, verify immediately after locking that squad, captain, and
chip changes are blocked. Then score, inspect, apply the configured correction,
and complete the gameweek:

```bash
npm run test:staging -- score gw1
npm run test:staging -- correct gw1
npm run test:staging -- unlock gw1
```

The scoring action prints every configured individual match, independently
calculates expected player and fantasy-team totals, compares them with
Supabase, and runs the database calculation twice to check idempotency.

## Test Gameweek 2

Keep Gameweek 1 installed. Between gameweeks, change staging squads or select a
different chip if those behaviours are under test. Then run the next lifecycle:

```bash
npm run test:staging -- lock-cron gw2
sleep 360
npm run test:staging -- status gw2
npm run test:staging -- score gw2
npm run test:staging -- correct gw2
npm run test:staging -- unlock gw2
```

This preserves the first snapshot and score, allowing Progress, cumulative
leaderboards, free-transfer rollover, transfer penalties, and one-use chips to
be inspected across gameweeks.

## Status and cleanup

Show every configured gameweek or only one key:

```bash
npm run test:staging -- status
npm run test:staging -- status gw1
```

Remove one gameweek or the entire synthetic stage:

```bash
npm run test:staging -- cleanup gw1
npm run test:staging -- cleanup
```

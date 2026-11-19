# Gameweek assignment periods

STUPA supplies the initial round skeleton. Fantasy fixture membership follows
persisted chronological periods from GW6 of the 2026/27 men's stage (5727).
GW1–GW5 retain their fixture assignments, lifecycle and prize records. Results
continue to import and score against their saved squads, as for every round.

## Initialization

Group each round's confirmed fixtures into Europe/Stockholm Monday–Sunday weeks.
Choose the unique week with the most fixtures and its median kickoff; average
the two middle instants for an even count. Reject tied dominant weeks, shared
weeks between rounds, missing anchors and non-chronological round anchors.
Midpoints use elapsed time between anchors. Compare the surrounding Stockholm
midnights, selecting the nearer midnight and the later one on an exact tie.
This handles 23/25-hour DST dates without assuming a day is 24 hours.

Periods are `[start, end)`, contiguous and positive in length. A fixture at a
boundary belongs to the later period. Outer bounds are unbounded within the
stage; the first new-policy period in stage 5727 starts at its GW5/GW6 cutover.
The current schedule yields 28 November, 12 December and 30 December 2026 at
Stockholm midnight for GW5/6, GW6/7 and GW7/8 respectively.

Anchor/boundary metadata is stored on `fantasy_gameweeks`; the private policy
records stage, first affected round, cutover, version and initialization time.
Once initialized, imports reuse boundaries even if source fixture counts would
now pick a different dominant week. Unexpected rounds or amendments stop for a
reviewed, validated change through the normal migration/release process.

## Moves and lifecycle

`persist_gameweek_schedule` validates and applies the complete stage update in
one transaction, including clubs, fixture identity/assignment, initialization,
lifecycle and durable source/destination rescoring requests. A failure rolls
back all schedule changes. It does not delete omitted source fixtures.

Fixtures move automatically between unfinished weeks, even after selection
locks. A non-null `data_refreshed_at` identifies successful completion. Adding
to or removing from finished membership fails, as does crossing protected
historical membership. Errors identify the fixture, clubs, kickoffs and states.
Moving a fixture does not modify submitted squads, captaincy, chips or budgets.
Scoring derives substitutions and multipliers from the destination snapshot.

The earliest required fixture locks selection two hours before kickoff. Passed
deadlines are preserved. Unfinished reopening follows midnight after the last
required fixture ends, then successful results persistence, scoring and readiness
checks. The period end is never a reopening deadline. A fixture moved out no
longer delays its source week. Independent weeks can score/complete while the
existing global transfer lock still blocks editing for another unfinished week.

Explicitly postponed undated fixtures keep their assignment, have no fabricated
date, and do not block completion. Cancelled/deleted fixtures keep their records,
score no points, and are excluded from requirements. Empty weeks keep their last
valid lifecycle and are reported; normal scoring/completion can finish them.
An undated fixture receiving a date after its retained week finishes requires
manual resolution under the same completed-membership invariant.

Only explicit status spellings already recognized by the application are
accepted. Missing dates on ordinary `NOT_STARTED` fixtures and unknown statuses
fail for source verification; they are not guessed to mean postponement. The
verified current feed contains only `SCORED` and `NOT_STARTED`. A new provider
representation must be supported using a verified payload, with regression
coverage, before importing it automatically.

## Results and retries

Every non-dry results import refreshes schedules before fetching/processing
results. Stage transaction locks serialize schedule, results, snapshot, scoring
and completion operations. The private rescoring worklist survives failures
after an assignment commit; `score_gameweek_refresh` rescores both old and new
weeks transactionally and clears work only on success. Completion rechecks the
current schedule timestamp, required fixture statuses and pending scoring.
Completed weeks retain their marker and lifecycle when their existing results
are corrected. GW1–GW5 retain their original fixture membership but still
receive result updates and scoring. An unfinished legacy round must persist
all required fixture results and score successfully before completing; a failed
step leaves transfers closed. Unchanged results preserve points, while source
corrections or scoring fixes can change historical totals. For example, the
cutover migration also corrected the clincher bonus to use a deciding golden
doubles as the final submatch; rescoring can correct older affected fixtures.
Saved squads,
captaincy, chips, player prices and team budgets are not replaced by imports.
All rounds in future stages use the same results path without a season switch.

Migration `20261118144700_refresh_all_gameweek_results.sql` removes the former
result freeze without changing historical membership protection. Deploy it
through the normal staging migration workflow before running the updated
importer; then rerun `npm run import:results:staging -- --complete-gameweek-refresh`
to import the missing GW5 results and finish the round. Production migration
and imports remain subject to the normal release and authorized Actions flow.

The nightly 00:07 Stockholm run and 15-minute playing-day polling cadence stay
unchanged. Newly moved playing days are discovered by schedule synchronization;
the polling gate itself still uses persisted fixture dates. Validation errors
fail Actions with an error annotation and a job summary. Maintainers should
verify their personal Actions failure notifications for nightly and dispatched
runs. No notifier, new hosted credential or Vercel variable is introduced.
Prize reveal dates, manual winners and competition information are preserved.

## Local migration demonstration

This local-only control uses separate synthetic stage `-900006`, existing clubs,
and future fixtures. It never resets data or changes accounts/squads. Its ignored
manifest is `test-results/bucket-migration-demo.json`.

Prepare legacy fixture data before applying the bucket migration (or use the
same setup on a newly migrated local stack to repeat the upgrade scenario):

```bash
npm run test:local -- status
npm run test:buckets:local -- prepare
```

`prepare` saves fixture `-906003` in source GW6 with a kickoff in GW7's period.
After upgrading code and applying the forward migration locally:

```bash
npm run db:migrate
npm run test:buckets:local -- verify
```

`verify` runs the actual schedule importer, asserts GW6 → GW7 reassignment,
preserved fixture identity and idempotent reimport. It leaves the synthetic
gameweeks available for inspection. It refuses duplicate setup or hosted targets.
Setup explicitly inserts only this new synthetic stage in its legacy state;
verification uses the actual transactional schedule importer. It never replaces
an initialized stage or bypasses protection on existing gameweeks.

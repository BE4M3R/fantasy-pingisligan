# Updating an existing checkout

Use this checklist after pulling changes. Read new migrations before applying
them and back up important production data first.

## Standard update

```bash
git pull
npm install
npm run lint
npm run build
```

Then check the pulled commits for new files in `supabase/`. A migration changes
the shared Supabase database, so it only needs to be applied once per Supabase
project. If both developers use the same project and one person has already run
it, the other person must not run it just because they pulled the code. Agree
who applies migrations and record that they have been applied.

For a separate Supabase project, apply required migrations in the Supabase SQL
editor in commit/feature order. Do not rerun the entire `schema.sql` as an
update mechanism; it represents the full new-project schema and is not a
migration history.

## Update introduced by the recent Stupa work

For a Supabase project that predates the schedule and result importers, apply
the following once. Skip this step when another developer has already applied
them to the same shared project:

1. `supabase/stupa-stage-schedule-migration.sql`
2. `supabase/stupa-results-migration.sql`

Your friend should stop here when the shared database has already been migrated
and imported. Pulling application code does not require running an importer.

## Data operator only

Only the developer responsible for refreshing the shared sports data should
run the following commands. Run them when importing a new or updated Stupa
stage, not as part of every developer update:

```bash
npm run import:schedule:dry
npm run import:schedule
npm run import:results:dry
npm run import:results
```

The schedule import must precede results because results reference parent rows
in `matches`. The scripts use upserts and are intended to be safely rerunnable.
The result import also recalculates every affected fantasy gameweek. Review
warnings about missing matches or unmatched players after every run.

## Transfer locking and squad snapshots

Apply these migrations once, in this order:

1. `supabase/transfer-window-lock-migration.sql`
2. `supabase/squad-snapshot-cron-migration.sql`
3. `supabase/chips-migration.sql`
4. `supabase/save-squad-draft-migration.sql`
5. `supabase/irreversible-chip-selections-migration.sql`
6. `supabase/scoring-rules-migration.sql`
7. `supabase/chip-state-from-lock-migration.sql`
8. `supabase/midnight-unlock-migration.sql`
9. `supabase/remove-lost-set-penalty-migration.sql`

Before the second migration, enable **Cron** under **Integrations** in the
Supabase Dashboard if it is not already enabled. The migration creates the
snapshot tables and schedules `snapshot_locked_squads()` every five minutes. Check
**Integrations > Cron > Jobs > snapshot-locked-squads > History** to verify
runs. The chip-state migration removes the older `mark-used-chips` job. A chip
choice becomes permanent as soon as the user confirms it and is marked as
locked when the snapshot job runs. A snapshot run outside a locked gameweek
correctly reports zero new snapshots.

To test from the SQL editor after temporarily closing a gameweek, run:

```sql
select * from public.snapshot_locked_squads();

select *
from public.fantasy_team_gameweek_snapshots
order by snapshotted_at desc;

select *
from public.fantasy_team_gameweek_players
order by created_at desc;
```

The first call during a new locked gameweek reports inserted rows. Running it
again reports zero new rows, confirming that retries do not duplicate data.

## Historical squad results

Apply `supabase/result-gameweek-navigation-migration.sql` once to let result
mode load any of the signed-in user's snapshotted gameweeks. This adds the
gameweek-specific result and set-breakdown functions used by the previous and
next arrows; it does not modify existing results or snapshots.

## Squad club limit

Apply `supabase/club-player-limit-migration.sql` once to enforce the maximum of
two players per club. The migration stops without changing the database if an
existing squad already exceeds the limit; correct that squad and run it again.

## Unique fantasy team names

Apply `supabase/unique-team-names-migration.sql` once to prevent two completed
fantasy teams from using the same name, including capitalization variants. The
migration stops without changing the database if completed teams already have
duplicate names; rename those teams and run it again.

## Dynamic player prices and team value

Apply `supabase/dynamic-player-prices-migration.sql` once before the next player
price refresh. It adjusts a completed team's total budget by each player-price
delta from its pending gameweek snapshot, preserving unspent cash while
allowing team value to rise or fall. It also adds `data_refreshed_at` and keeps
transfers closed after the scheduled unlock until the nightly results and
player-price workflow finishes successfully. Existing completed gameweeks are
backfilled as already refreshed when the migration is applied.

The migration cannot reconstruct price changes imported before it was applied.
For an already-negative team, determine its cash immediately before that import
and correct its `fantasy_teams.budget` once. If the team had no unspent cash,
set its budget to the current sum of its six player prices. Review the target
team and amount before running that data correction.

The GitHub Actions workflow change uses the existing `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` secrets; no new secret is required. Apply this
migration before deploying or enabling the updated workflow.

## Private leaderboards

Apply `supabase/private-leaderboards-migration.sql` once to enable creating
invite-only leaderboards, joining with invitation codes and member-only ranking
queries. The migration also adds existing league owners as members.

## Environment checklist

Local `.env.local` needs the public URL and anonymous key for the application.
Real imports additionally require `SUPABASE_SERVICE_ROLE_KEY`. Never commit that
file or copy the service-role key into a `NEXT_PUBLIC_*` variable.

Vercel needs the two public variables documented in the root README. The local
import scripts do not require adding the service-role key to Vercel unless an
intentional server-side scheduled importer is later deployed there.

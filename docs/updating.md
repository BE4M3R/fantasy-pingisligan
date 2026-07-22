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
Review warnings about missing matches or unmatched players after every run.

## Transfer locking and squad snapshots

Apply these migrations once, in this order:

1. `supabase/transfer-window-lock-migration.sql`
2. `supabase/squad-snapshot-cron-migration.sql`
3. `supabase/chips-migration.sql`

Before the second migration, enable **Cron** under **Integrations** in the
Supabase Dashboard if it is not already enabled. The migration creates the
snapshot tables and schedules `snapshot_locked_squads()` every five minutes. Check
**Integrations > Cron > Jobs > snapshot-locked-squads > History** to verify
runs. The chips migration also schedules `mark_used_chips()` every fifteen
minutes. A run outside a locked gameweek correctly reports zero new snapshots.

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

## Squad club limit

Apply `supabase/club-player-limit-migration.sql` once to enforce the maximum of
two players per club. The migration stops without changing the database if an
existing squad already exceeds the limit; correct that squad and run it again.

## Environment checklist

Local `.env.local` needs the public URL and anonymous key for the application.
Real imports additionally require `SUPABASE_SERVICE_ROLE_KEY`. Never commit that
file or copy the service-role key into a `NEXT_PUBLIC_*` variable.

Vercel needs the two public variables documented in the root README. The local
import scripts do not require adding the service-role key to Vercel unless an
intentional server-side scheduled importer is later deployed there.

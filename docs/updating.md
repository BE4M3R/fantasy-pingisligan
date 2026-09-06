# Updating an existing checkout

Use this checklist after pulling application changes:

```bash
git pull
npm install
npm run lint
npm run build
```

Do not paste database SQL into a remote SQL Editor. Timestamped migrations are
validated on pull requests and deployed by the staging and production GitHub
Actions described in [Database migrations](database-migrations.md).

For local database development, start Docker and rebuild from the committed
migration history:

```bash
npm run db:start
npm run db:reset
npm run db:lint
npm run db:stop
```

The SQL files under `supabase/legacy/` predate automated migration tracking.
They are retained only to explain historical database changes and must not be
applied to a baselined database.

## Data operator only

Only the developer responsible for refreshing shared sports data should run
the importer commands. They are not part of a normal checkout update:

```bash
npm run import:schedule:dry
npm run import:schedule
npm run import:results:dry
npm run import:results
```

The schedule import must precede results because results reference parent rows
in `matches`. The scripts use upserts and are intended to be safely rerunnable.
Review warnings about missing matches or unmatched players after every run.

Before running the player identity reconciliation against a shared database,
run the identity tests and preview the changes:

```bash
npm run test:imports
npm run import:players:dry
```

## Environment checklist

Local `.env.local` needs the public URL and anonymous key for the application.
Real imports additionally require `SUPABASE_SERVICE_ROLE_KEY`. Never commit that
file or copy the service-role key into a `NEXT_PUBLIC_*` variable.

Vercel needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the
site URL documented in the root README. The local import scripts do not require
adding the service-role key to Vercel.

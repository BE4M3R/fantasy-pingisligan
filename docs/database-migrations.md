# Database migrations and deployments

Database schema changes are versioned in `supabase/migrations/` and applied in
filename order by the Supabase CLI. Do not make schema changes directly in the
SQL Editor or Table Editor on staging or production after completing the
one-time baseline procedure below.

The old manually applied scripts are retained in `supabase/legacy/` for audit
history only. They must not be run again.

## One-time baseline

The migration `20260906000000_baseline_schema.sql` represents the complete
schema that staging and production are expected to contain today. It can build
a new local database, but it must not be executed against either existing
remote database.

Complete these steps separately for staging and production before enabling the
deployment workflows:

1. Back up the database.
2. Install dependencies with `npm install`.
3. Sign in with `npx supabase login`.
4. Link the environment:

   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```
5. With Docker running, compare the migration baseline to the remote schema:

   ```bash
   npx supabase db diff --linked --schema public
   ```

   Review any generated SQL. An empty diff means the public schemas agree. Do
   not register the baseline if the output shows an unexplained difference.

6. When the schemas agree, register the baseline without executing its SQL:

   ```bash
   npx supabase migration repair 20260906000000 --status applied
   npx supabase migration list
   npx supabase db push --dry-run
   ```

   The list should show `20260906000000` in both the local and remote columns,
   and the dry run should report no pending migrations.

Also run `show server_version;` in either remote SQL Editor and set
`db.major_version` in `supabase/config.toml` to that major version if it differs
from the current value. Staging and production should use the same major
Postgres version.

## GitHub configuration

In **Settings > Environments**, create `staging` and `production`. Add these
environment secrets to each one, using that environment's values:

- `SUPABASE_PROJECT_ID`: the project reference from the dashboard URL.
- `SUPABASE_DB_PASSWORD`: the project's database password.

Add `SUPABASE_ACCESS_TOKEN` as a repository Actions secret. This is a personal
access token created in the Supabase account settings; it is not the anonymous
key or service-role key.

Configure required reviewers on the `production` GitHub Environment so a human
must approve production migrations. Finally, create the repository Actions
variable `DATABASE_MIGRATIONS_ENABLED` with value `true`. Until this variable
exists and equals `true`, both deployment jobs intentionally skip.

Each deployment also refuses to run unless the remote migration history already
contains the baseline version. This second guard prevents an enabled workflow
from accidentally executing the full baseline against an existing database.

Create the staging branch after the baseline setup:

```bash
git switch -c develop main
git push -u origin develop
```

The workflows then behave as follows:

- Pull requests validate that a clean local database can be rebuilt from the
  committed migrations and lint database functions.
- Merges to `develop` apply pending migrations to staging.
- Merges to `main` apply the same pending migrations to production after the
  production environment approval.
- **Actions > Check database migration status > Run workflow** compares the
  tracked schema and migration history with either remote environment without
  applying changes.

## Making a schema change

Start from `develop` and create a timestamped migration:

```bash
git switch develop
git pull
npm run db:new -- describe_the_change
```

Edit the generated SQL, then rebuild and lint locally:

```bash
npm run db:start
npm run db:reset
npm run db:lint
npm run db:stop
```

Commit the new file and open a pull request into `develop`. Test the application
against staging after that PR is merged. Promote the exact tested commit by
opening a pull request from `develop` into `main`.

Never edit an already deployed migration. Add a new migration that moves the
schema forward. Keep player, fixture and result imports in their existing
server-side jobs; migrations are for schema objects, policies, functions,
triggers, and small controlled reference-data changes.

# Supabase database workflow

## Branch flow

```text
feature branch -> develop -> staging -> main -> production
```

- Pull requests validate migrations automatically.
- Migrations reaching `develop` deploy automatically to staging.
- After staging is tested, merge `develop` into `main`.
- Migrations reaching `main` deploy to production after approval.

## Make a database change

```bash
git switch develop
git pull
npm run db:new -- describe_the_change
```

Edit the new timestamped file in `migrations/`. With Docker running, test it:

```bash
npm run db:start
npm run db:reset
npm run db:lint
npm run db:stop
```

Never edit a deployed migration or change staging/production manually. Create a
new migration instead. Files in `legacy/` are archived and must not be applied.

See [`docs/database-migrations.md`](../docs/database-migrations.md) for setup,
status checks, secrets, and troubleshooting.

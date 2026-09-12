# Repository guide

This directory explains how Fantasy Pingisligan works and how to operate it.
Start with the root [README](../README.md) to install and run the application.

## Where things live

| Path | Responsibility |
| --- | --- |
| `app/` | Next.js routes, pages, API routes, Server Actions and UI components |
| `app/dashboard/` | Protected fantasy-team UI and squad mutations |
| `app/api/players/` | Authenticated, lazy-loaded player-pool endpoint |
| `lib/supabase/` | Browser, server and middleware Supabase clients |
| `scripts/` | Server-only Profixio and Stupa importers |
| `supabase/migrations/` | Versioned schema baseline and incremental changes |
| `supabase/legacy/` | Archived pre-automation SQL; never reapply |

## Reading order

1. [Architecture](architecture.md)
2. [Design system](design-system.md)
3. [Database](database.md)
4. [Database migrations](database-migrations.md)
5. [Data imports](data-imports.md)
6. [Updating a checkout](updating.md)
7. [Staging gameweek test](staging-testing.md)
8. [Performance inventory](performance-inventory.md)

## Important rules

- Database reads should normally remain in Server Components.
- Use Client Components only for browser interaction.
- Importers and service-role credentials must never run in the browser.
- Make every schema change as a new timestamped file in
  `supabase/migrations/`; never edit a migration that has been deployed.

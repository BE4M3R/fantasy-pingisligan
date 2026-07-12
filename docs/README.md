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
| `supabase/schema.sql` | Complete schema for a new database |
| `supabase/*-migration.sql` | Incremental changes for an existing database |
| `docs/flowcharts/` | Mermaid diagrams of important runtime flows |

## Reading order

1. [Architecture](architecture.md)
2. [Database](database.md)
3. [Data imports](data-imports.md)
4. [Updating a checkout](updating.md)
5. [Flowcharts](flowcharts/README.md)

## Important rules

- Database reads should normally remain in Server Components.
- Use Client Components only for browser interaction.
- Importers and service-role credentials must never run in the browser.
- Treat `schema.sql` as the full current schema and migration files as the path
  for updating an already-created Supabase project.

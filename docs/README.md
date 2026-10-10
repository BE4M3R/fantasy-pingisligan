# Repository guide

This directory explains how Fantasy Pingisligan works and how to operate it.
Start with the root [README](../README.md) to install and run the application.

## Where things live

| Path | Responsibility |
| --- | --- |
| `app/` | Next.js routes, pages, API routes, Server Actions and UI components |
| `app/(default)/dashboard/` | Protected dashboard route pages and layout |
| `app/dashboard/` | Shared dashboard UI and Server Actions for squad/league mutations |
| `app/api/players/` | Authenticated, lazy-loaded player-pool endpoint |
| `lib/supabase/` | Browser, server and middleware Supabase clients |
| `scripts/` | Server-only player catalogue and STUPA importers |
| `supabase/migrations/` | Versioned schema baseline and incremental changes |
| `supabase/legacy/` | Archived pre-automation SQL; never reapply |
| `tests/` | Unit, authenticated database and Playwright browser suites |
| `.agents/skills/` | Repository Codex workflows: `verify-ui` and `prepare-pr` |

## Reading order

1. [Architecture](architecture.md)
2. [Design system](design-system.md)
3. [Database](database.md)
4. [Database migrations](database-migrations.md)
5. [Data imports](data-imports.md)
6. [Updating a checkout](updating.md)
7. [Staging gameweek test](staging-testing.md)
8. [Automated testing](automated-testing.md)
9. [Performance inventory](performance-inventory.md)
10. [Home matches and stream links](home-matches.md)
11. [Privileged GitHub Actions security (Phase A2)](privileged-workflows-security.md)

## Task shortcuts

Use [AGENTS.md](../AGENTS.md) for project rules and the task-to-document map.
[Automated testing](automated-testing.md#choose-checks-by-change) owns test
selection, local isolation, rendered UI inspection and PR preparation.
For interactive local scenarios, use the
[local state controls](staging-testing.md#local-state-controls): status, prepare,
lock, kickoff, one singles/doubles result at a time, score and unlock.

The repository skills reference these guides rather than duplicating them:

- [$verify-ui](../.agents/skills/verify-ui/SKILL.md): inspect a UI change at mobile
  and desktop sizes, including screenshots and loading/error states.
- [$prepare-pr](../.agents/skills/prepare-pr/SKILL.md): review the intended diff,
  run relevant checks and draft a PR targeting `develop`.

Examples in Codex:

```text
$verify-ui Check the player picker on mobile and desktop, including loading and overflow. Capture and inspect screenshots.
$prepare-pr Review this branch and uncommitted changes, run the appropriate checks, and draft a PR into develop. Do not commit, push or create it.
```

Skills are versioned in `.agents/skills/<name>/SKILL.md`. Reopen the repository
in a new Codex session if newly added skills are not listed yet; as a fallback,
ask Codex to read and follow the specific `SKILL.md` path.

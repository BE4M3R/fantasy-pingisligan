# Competition launch and rollback

Competitions are unpublished by default. Merging code does not launch prizes.
All enable switches live in **Supabase Studio → Table Editor →
`competition_publication`**. Edit the `enabled` cell on the required row:

| `id` | `name` | `enabled` |
| --- | --- | --- |
| `global` | All competitions | Master switch; false hides every prize competition |
| `season` | Season competition | Independent season prize opt-in; false for this season |
| `gameweek:<uuid>` | Gameweek 1 competition, Gameweek 2 competition, … | Opt each round in separately |

The `gameweek_id` foreign key identifies the real Fantasy round, so repeated
numbers in different seasons cannot share a switch. Imported rounds automatically
receive disabled rows. Schedule refreshes update their names without changing
`enabled`. Do not add columns or recreate these rows manually. Deleting a Fantasy
round removes only its linked publication row.

For this weekly-only season, leave **global enabled**, **season disabled**, and
enable only the selected gameweek rows. Season discovery, page, terms and artwork
remain hidden. Ordinary Fantasy Season/Gameweek standings stay available.

## Enabling does not control the clock

A gameweek row opts a round into prize competition. Existing `lock_at`, fixture
times, `current_transfer_lock()` and successful `data_refreshed_at` still control
entry closing, live play, pending results and completion. Selecting a future round
shows only a generic teaser, never its unrevealed prize. Passing the scheduled
unlock time without successful scoring does not reveal the next round.
History and the next two selected future teasers remain available as before.

Prize preparation still uses `homepage_banners` (`content_ready` for gameweeks;
independent publication dates for season). Shared `competition_rules` documents
retain their separate approval/versioning. Enable switches are centralized;
prize content and approved terms retain their existing tables and protections.

## Disclosure and authorization

`competitions_enabled()` reads the `global` row. `season_competition_enabled()`
requires both `global` and `season`. Gameweek routes, standings, promotions,
carousel content, direct banner/rule reads and artwork require global plus the
matching gameweek row, as well as their existing reveal/readiness gates.
The shared Rules page uses `get_current_competition_rules()` separately: approval
publishes the latest policy without requiring a prize row. Global must be enabled;
Season policies also require the season switch. Draft rules remain private.
Missing rows and failed configuration reads disable access. Anonymous and ordinary
authenticated users can read non-sensitive switches but cannot edit them. There is
no public environment variable, cookie, hostname bypass or privileged app client.

When global is off, competition pages return 404/noindex and competition APIs
return 404. Competition links, public promotions and carousel placeholders are
absent. Robots disallows competition routes. With only season off, its route is
blocked separately. Competitions are never included in the sitemap.
Authenticated Fantasy standings, squads, snapshots, transfers, chips and private
leagues remain independent. No winner or announcement is automatically published.

## Local development and verification

Apply migrations only to local Supabase during development. Each environment has
its own rows; editing local never changes staging or production. A local operator
can use Studio (normally `http://127.0.0.1:54323`) or its SQL editor:

```sql
update public.competition_publication set enabled = true where id = 'global';
update public.competition_publication set enabled = false where id = 'season';
-- Choose the row by its linked Fantasy gameweek UUID, not just its number.
update public.competition_publication set enabled = true
where gameweek_id = '<gameweek-uuid>'::uuid;
```

Forward migration `20261110223000_centralize_gameweek_competitions.sql` preserves
existing global, season and per-gameweek choices while moving them into rows. It
replaces the earlier boolean-keyed singleton and removes the old per-round flag.
Generic titles become `Gameweek <number> competition`. Editable prize copy and
rule drafts are renamed. Approved terms and their historical bindings remain
immutable; where necessary an unapproved renamed draft is prepared for review.
Deployed migration files remain unchanged as schema history.

`npm run check:all` uses a disposable database to test populated upgrades, settings
and content preservation, default-off new rows, schedule upserts, RLS, direct
Storage access, routes, search, unchanged scoring/lifecycle and browser navigation.
It never resets the populated local stack. Test fixtures explicitly opt their
required rows in and restore the global/season switches during cleanup.

## Staging and production release

1. Human review/merge into `develop` deploys pending migrations to staging through
   the existing GitHub Actions workflow. Schema deployment preserves existing
   choices; new databases start disabled. No migration publishes new prizes.
2. Complete sponsor and [rule review](competition-rules/README.md); prepare prizes
   and unapproved documents separately from enable switches.
3. Only with explicit staging authorization, enable the required rows and verify
   public/signed-in pages, timing, standings and hidden content. Withdraw again
   if the staging competitions should remain inaccessible afterward.
4. Promote the exact tested `develop` commit through a human-merged `develop` →
   `main` PR. Production content is prepared separately; local/staging content is
   never copied automatically. Codex never merges or dispatches hosted writes
   without authorization.
5. At the separately authorized launch, enable global and the selected gameweek
   rows. Leave season disabled for this season. No Vercel variable is required.

## Withdrawal

Set `enabled = false` on global to hide everything, on season to hide its prize,
or on a gameweek row to withdraw only that round. Saved prize content, standings
and bound terms are preserved. Use per-banner readiness/publication to withdraw
content while retaining a generic opted-in competition.

New reads take effect without a persistent publication cache. Already rendered
browser history or downloaded content cannot be recalled. Previously signed
artwork URLs may remain valid for their five-minute lifetime. Use unique artwork
paths rather than sharing objects with separately published announcements.

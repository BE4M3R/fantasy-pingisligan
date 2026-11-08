# Competition launch and rollback

Weekly Smash and Season Competition are **unpublished by default**, including for
signed-in managers. Merging this feature into `develop` or promoting it to `main`
does not launch it. Rule approval and per-banner publication are separate controls.

## One shared publication switch

Forward migration `20261101200000_gate_competition_publication.sql` creates one
`competition_publication` row (`id = true`, `enabled = false`). Ordinary anonymous
and authenticated API users have SELECT access to this harmless boolean only;
only a trusted operator/service role can update it. Missing or failed reads are
handled as disabled. There is no browser, header, cookie, hostname or public env
variable that can enable the feature, and no privileged client is added to the app.

When disabled:

- Public homepage promotions and the signed-in carousel return no cards or links.
  There is no competition loading placeholder or fallback discovery link.
- Leagues keeps its existing global/private tables. The new Season/Gameweek controls
  and competition links are absent; a forced `view=gameweek` uses the global table.
- Numeric and UUID competition URLs and the season page return 404 with noindex
  metadata. Competition APIs return 404; the authenticated weekly API also checks
  the switch. Competition routes are disallowed in robots.txt while disabled. They
  are never added to the sitemap, regardless of this flag.
- Restrictive RLS ANDs the switch with existing banner/rules visibility policies.
  Even approved rules and ready/published prizes cannot be read by visitors or
  ordinary managers. Public detail/discovery/route/state RPCs return no rows.
  Security-definer weekly standings RPCs refuse requests with SQLSTATE 42501.
- Banner artwork cannot be newly signed or downloaded through the existing
  banner-reference policy. Existing announcement publication/dismissal behavior,
  global Fantasy scoring, squads, snapshots, transfers and private leagues remain.

Unapproved rule versions remain hidden when the switch is on too. Future/unready
weekly prizes and independently unpublished season content retain their existing
RLS and artwork restrictions. This switch does not approve terms or confirm a winner.

## Local development and verification

Use local Supabase only. After applying pending migrations locally, a developer can
explicitly enable the existing local preview from local Studio's SQL editor:

```sql
update public.competition_publication set enabled = true where id = true;
```

Run this only against the intended local stack (normally Studio at
`http://127.0.0.1:54323`), never as an inherited hosted command. The populated local
demo has preview enabled intentionally. New databases and hosted migration runs
start disabled; local data and this opt-in are not copied through Git deployment.

The normal local pages retain their approved historical rule references. Current
Git-authored review drafts are unapproved and cannot be bound to public pages.
The schema guard is intentional: do not weaken it to preview private text.

`npm run check:all` uses its own disposable database. Its migration checks verify
the default is off; ordinary Fantasy fixtures keep it off. Competition-specific
fixtures explicitly opt in and restore it to false during cleanup. Dedicated
functional/browser checks use ready prizes and draft/approved rules to verify
closed routes, metadata, APIs, direct reads, Storage and forbidden flag updates,
then test an explicit local enable/disable cycle. The normal populated demo is
never reset by this suite.

## Staging and production release

1. Keep the flag off. Human review/merge of the feature PR into `develop` lets the
   existing GitHub Actions workflow deploy migrations to staging. Codex must not
   merge, dispatch hosted writes, or change hosted configuration without approval.
2. Complete legal and sponsor review using the [rule review guide](competition-rules/README.md).
   Create shared draft rows from the Git-reviewed Markdown in staging; prepare
   each banner's prize/sponsor/artwork/conditions without publishing the feature.
3. Only with explicit authorization, an operator enables the flag in staging and
   verifies public/signed-in navigation, standings, rules and hidden content. This
   is an intentional staging publication, not a preview bypass. Disable again if
   the staging feature must remain inaccessible after testing.
4. Promote the exact tested `develop` commit through a human-merged `develop` →
   `main` PR. Production migrations start with the feature off. Prepare/review
   production content separately; local/staging content is not automatically copied.
5. At the separately approved launch, an authorized operator sets `enabled = true`
   in the intended environment after checking terms, sponsor arrangements, prizes
   and publication dates. No Vercel variable is required for this gate. Existing
   per-banner and approved-rule policies still apply.

No hosted writes or launch are performed by merely preparing this branch. Hosted
schema changes continue exclusively through the existing migration workflow.

## Disable or postpone launch

An authorized operator sets `enabled = false` on the same row. App reads use
request memoization without a persistent publication cache; new requests fail
closed. Keep per-banner publication controls for withdrawing individual prizes.

Previously downloaded public content cannot be recalled. Private artwork URLs
already issued before disabling can remain usable for up to their five-minute
expiry. Previously rendered browser history can retain an old view; new API/page
requests are blocked. Use unique competition artwork paths, never reuse an object
already exposed by a published announcement. These are limits of prior disclosure,
not an exception permitting unpublished content on a fresh deployment.

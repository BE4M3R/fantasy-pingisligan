# The Weekly Smash and Season Competition

Home (`/dashboard/overview`) derives competitions from `fantasy_gameweeks`.
Only Gameweeks explicitly opted in with `fantasy_gameweeks.weekly_smash_enabled`
appear as prize competitions. No content row is needed for an opted-in Gameweek
to exist in the carousel. Existing and newly imported rounds default to excluded,
and schedule refreshes preserve your selection. `homepage_banners` supplies optional content,
with at most one row per gameweek and one season row. Announcements, inbox
history and dismissals remain separate.

The feature-wide launch switch in `competition_publication` defaults to disabled.
Until explicitly enabled, no carousel cards or competition links are shown, even
when banners are ready or published. Direct database and artwork reads are also
gated. See [safe competition launch](competition-launch.md).

## Automatic lifecycle and navigation

`homepage_gameweek_states()` reads the existing `current_transfer_lock()` rule.
While transfers are open, the next gameweek by `lock_at` is current and revealed,
including before the first gameweek. After locking, its content remains revealed
through play and the pending results refresh. Passing `unlock_at` alone does not
complete it: `data_refreshed_at` must be set by the successful Fantasy refresh.
Other unresolved locked gameweeks remain accessible too; any outstanding Fantasy
lock prevents revealing the next future round. No competition state is stored.

The carousel contains opted-in history/locked rounds in deadline order, the
opted-in current competition, **only the next two opted-in** upcoming teasers, and finally the
Season Competition. Numbers come from `round_order`, falling back to chronological
position. Schedule changes follow Fantasy's existing rules: future deadlines can
move, locked boundaries remain frozen, and postponed fixtures keep their original
gameweek. Reordering a future gameweek can return its content to embargo;
previously downloaded information cannot be recalled.

On each Home entry, select current; if none exists, select the latest completed
gameweek. With no gameweeks, show season alone. Entry positioning does not depend
on the currently selected slide or refreshed props and never interrupts browsing.
Swipe, pagination, desktop arrows, Left/Right and Home/End remain manual, without
autoplay. Arrows are hidden below 640px; reduced motion is respected.

Completed cards show “Awaiting winner confirmation”. The refresh marker means
Fantasy has completed its post-unlock processing, not that upstream scores can
never change. Public competition pages and provisional standings are available;
confirmation and winner announcements remain deferred. There is no new scoring
system or winner field. See [competitions](competitions.md).

## Choose which Gameweeks have prizes

In Supabase Studio, open `fantasy_gameweeks` and set **`weekly_smash_enabled =
true`** only for rounds that will have a Weekly Smash prize. Leave it **false**
for unconfirmed past/upcoming rounds. Change it back to false to exclude a round.
All existing and new rounds start false; the migration never guesses a launch
week or assumes that an already configured prize will be awarded.

Excluded rounds have no carousel card (including generic teasers), public
competition page, promotion or competition link in Leagues. Their prize/rules
and artwork stay protected. Fantasy scoring, squads, Gameweek numbers and all
signed-in Leagues standings remain available. The next two teaser slots skip
excluded rounds; hiding GW1 does not renumber GW2. Prize content and historical
rule bindings are preserved for later opt-in.

The global `competition_publication.enabled` switch must also be true to publish
competitions. Choose prize rounds first; enable the global switch separately
when ready to launch. These controls are independent of `content_ready` below.

## Weekly content in Supabase

Develop and verify locally. Hosted content editing is a human operator task in
Supabase Dashboard; staging requires explicit opt-in. Ordinary app users cannot
insert, update or delete content or upload artwork.

1. In `homepage_banners`, create a row. `kind` defaults to `gameweek`; select an
   existing `gameweek_id`. Do not create a separate teaser or reveal row.
2. Optional `title` overrides “The Weekly Smash” **after reveal** (100 characters).
   Future teasers always use the generic title and gameweek number.
3. Optional `sponsor` retains the name (80 characters) for branding metadata and
   accessible image fallback text. No “Sponsored by …” line is displayed.
4. Upload an optional PNG/JPEG/WebP logo or artwork, maximum 2 MiB, to the private
   `announcement-artwork` bucket. Use a unique path, for example
   `<banner-id>/sponsor.webp`, in `image_path`; enter descriptive `image_alt`.
   The carousel contains the image without cropping, on a compact light tile.
   Bold information lines sit beside the image; no text is placed below it.
   Information remains readable when the image is absent or fails to load.
5. Optional `cta_label` is the short prize headline (40 characters). It defaults
   to “Discover prize” when a valid destination exists. A headline can also be
   supplied without a destination.
6. Optional `description` is the concise prize summary (240 characters), shown
   as a smaller bold information line beside the logo, below the headline. Each
   information line is limited to one visual line to keep the banner compact.
   Lifecycle status shares this information area. Public competition pages show
   the complete summary and optional long-form content.
7. Revealed weekly banners automatically link to `/competitions/gameweek/<number>`;
   revealed season banners link to `/competitions/season`. No URL entry is needed.
   Existing UUID links redirect when their number is unambiguous. Reused numbers
   retain UUID links until season-aware URLs are introduced. The unused stored `cta_url`
   column has been removed; RPC destinations remain generated.
   Linked banners retain the plain gold chevron at the right.
8. Set `content_ready = true` after reviewing the content. You can do this well
   before the gameweek: database and Storage authorization prevent early access.
   Set it false to withdraw content on subsequent reads. The generic competition
   card remains; revealed cards without content show “Competition details coming soon”.

Do **not** manage weekly `published`, `publish_at`, or `expires_at`.
They are retained for season scheduling; unused `sort_order` is removed. The
weekly visibility gate uses only `content_ready` plus Fantasy state. There are
no weekly publication dates or manually maintained current/previous kinds.

## Season Competition in Supabase

Create or edit the single row with `kind = season` and `gameweek_id = null`.
Use the same optional title, sponsor, image, headline and description
fields, plus the [detail-page content](competitions.md#enter-a-new-weekly-smash-prize-in-supabase). Its default title is “Season Competition”. A crown, longer gold accent
and subtle gold court treatment distinguish it without changing the palette.

Enter approximate prize values with `prize_value_sek`; put any prize choices in
`prize_description`. Shared terms now live in versioned `competition_rules`
documents, separately for Weekly Smash and Season Competition. Approval and
automatic version assignment are described in [the content guide](competitions.md).
Do not repeat rules/eligibility on each weekly row or assume any prize is tax-free.

Season uses the existing independent publication controls:

- `published = false` keeps its content in draft.
- Set `publish_at` with an explicit timezone offset and `published = true` to
  announce immediately or later. Stockholm is +01:00 in winter and +02:00 in summer.
- Leave `expires_at = null` to keep revealed content throughout the season.
  An optional later expiry or `published = false` withdraws it.
- `content_ready` has no effect on season content.

Before publication, after withdrawal, or without a season row, Home still shows
a generic locked Season Competition **as the final slide**. It never counts
against the two-gameweek teaser limit. Once published, its reveal is independent
of weekly transfer locks. A custom season title is hidden until publication.

## Authorization, payload and loading

`get_homepage_competitions()` is an authenticated, security-invoker RPC. It joins
public gameweek state to content protected by RLS, returning safe generic cards
when content is unreadable. The same shared gameweek calculation is used by RLS;
there is no duplicated browser lifecycle calculation. Direct content requests
cannot read future weekly metadata, unready weekly rows or unrevealed season rows.
Anonymous readers can read only the granted public editorial columns of revealed
rows, and their sponsor/prize artwork. Announcement access remains authenticated.

Storage's competition policy checks the referenced banner through that same RLS.
The independent announcement policy remains unchanged. **Never reuse a published
announcement/banner object path for secret content**: any readable reference
makes the shared object readable. Use a new path when uploading embargoed artwork.
Existing signed URLs can remain usable for their five-minute lifetime after
withdrawal or schedule changes; previously seen content cannot be made secret.

A streamed Server Component performs one metadata RPC and one batch signing
request for readable artwork. No service-role client, persistent content cache,
polling, cron or new environment variables are introduced. An already-open Home
does not poll for publication; return/reload to obtain updated content and URLs.
Metadata errors show a neutral unavailable message; artwork failure keeps text.

## Forward migration and existing content

Keep `20261026120000_homepage_banners.sql` unchanged, including when it is locally
applied but untracked. Apply the new forward migration
`20261031120000_gameweek_homepage_competitions.sql` through normal local testing
and GitHub Actions deployments. Never edit hosted schema directly.

The migration runs transactionally with lock/statement timeouts. It first rejects
multiple rows for a gameweek or multiple season rows. An operator must review
conflicting rows and preserve their content before explicitly consolidating them;
the migration does not select, overwrite or delete campaigns. It also stops on
teaser/reveal duplicates, even when the teaser has no editorial fields.

All existing IDs, gameweek references, titles, descriptions, sponsors, artwork
paths/alt text, destinations/headlines, ordering, dates, published flags and
creation timestamps remain stored. Weekly kinds become `gameweek`. Only legacy
`current`/`previous` rows that are published, due and unexpired at migration time
receive `content_ready = true`. Draft, scheduled, expired and teaser rows remain
unready. Review these rows in Supabase and explicitly mark ready when appropriate;
old scheduled dates no longer automatically publish weekly content. Season
publication settings continue to work as before. No gameweeks, scores, squads,
accounts, prices, budgets or announcement interactions are changed.

## Validation

`npm run check:all` uses a disposable local stack. Populated upgrade checks verify
content/publication preservation, conservative readiness conversion, and duplicate
rejection with rollback. Functional tests exercise direct table/RPC/Storage reads,
operator-only writes, two-teaser limits, missing rows, Fantasy lock/refresh,
schedule changes, history and season publication. Browser coverage verifies Home
entry/re-entry/back selection, browsing without reset, desktop keyboard controls,
mobile Chromium touch swipes, reduced motion, responsive widths, missing content,
season reveal and completed fallback, with screenshots for visual inspection.

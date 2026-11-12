# Gameweek competition and Season Competition

Home (`/dashboard/overview`) derives competitions from `fantasy_gameweeks`.
Only Gameweeks with an enabled linked row in `competition_publication`
appear as prize competitions. No content row is needed for an opted-in Gameweek
to exist in the carousel. Existing and newly imported rounds default to excluded,
and schedule refreshes preserve your selection. Each existing and newly imported
Gameweek automatically receives a draft `homepage_banners` row with editable teaser
and prize reveal time. `homepage_banners` supplies optional content,
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
Other unresolved locked gameweeks remain accessible too. With `prize_reveal_at = null`,
any outstanding Fantasy lock prevents revealing the next future round. No
competition state is stored. These Fantasy states still own transfers, results
and scoring. Prize disclosure additionally uses the editable schedule below.

The carousel contains every opted-in Gameweek in deadline order: completed,
ongoing, current and all future rounds, followed by the Season Competition when
the `season` publication row is enabled. There is no limit on future cards.
Numbers come from `round_order`, falling back to chronological
position. Schedule changes follow Fantasy's existing rules: future deadlines can
move, locked boundaries remain frozen, and postponed fixtures keep their original
gameweek. Reordering a future gameweek can return its content to embargo;
previously downloaded information cannot be recalled.

On each Home entry, select the most recently completed Gameweek's manually selected
winner only during the 48 hours starting at that Gameweek's `unlock_at`. Once that
window expires, or if it has no selected winner, select current, then the latest
completed competition. An older winner never takes over the priority window.
The initial selection is calculated once on the server; the browser clock does
not affect it. Winner cards remain available through manual browsing afterwards.
With no gameweeks,
show season alone if opted in; otherwise hide the carousel. Entry positioning does not depend
on the currently selected slide or refreshed props and never interrupts browsing.
Swipe, pagination, desktop arrows, Left/Right and Home/End remain manual, without
autoplay. Arrows are hidden below 640px; reduced motion is respected.

Completed cards show “Winner pending” until an operator selects
a team in `competition_publication.competition_winner`. Selected cards show that
team's current name, followed by “Won <prize title>”, linking to the winner box on
the competition page. Lifecycle status appears in a box on the same row as the
competition heading: “Coming soon” for unrevealed competitions, “Ongoing” as soon as a competition
is revealed, including before its deadline and while transfers are locked
(or a results refresh is pending), and “Winner pending” after successful
unlock. “Winner announced” takes priority whenever a winner is selected and
remains until the operator changes or clears that selection.
One fresh batch RPC supplies public winner records for all slides; no per-slide
queries or client polling are added. The refresh marker means
Fantasy has completed its post-unlock processing, not that upstream scores can
never change. Scoring never selects or removes a winner; changing or clearing
the field controls the announcement. See [Table Editor winner selection](competitions.md#choose-a-gameweek-winner-in-table-editor).

## Choose which Gameweeks have prizes

In Supabase Studio, open `competition_publication` and change `enabled` on the
row named **Gameweek <number> competition**. Its `gameweek_id` links the real round.
Enable only rounds that have a prize. New rounds receive disabled rows
automatically; existing choices are preserved by migration and schedule refreshes.
The `global` row must also be enabled. No per-gameweek columns need to be added.

Excluded rounds have no carousel card (including generic teasers), public
competition page, promotion or competition link in Leagues. Their prize/rules
and artwork stay protected. Fantasy scoring, squads, Gameweek numbers and all
signed-in Leagues standings remain available. Future cards skip
excluded rounds; hiding GW1 does not renumber GW2. Prize content and historical
rule bindings are preserved for later opt-in.

The global `competition_publication.enabled` switch must also be true to publish
competitions. Choose prize rounds first; enable the global switch separately
when ready to launch. These controls are independent of `content_ready` below.

## Edit a Gameweek teaser

In Supabase Table Editor, open `homepage_banners`, find the row linked to the
Gameweek through `gameweek_id`, and edit its optional `teaser` (up to 240
characters). Rows are created automatically for all Gameweeks. If an operator
deleted a row, recreate it with `kind = gameweek` and the matching `gameweek_id`.
Use this single column on each banner row; no new column
is needed for each round. Publication controls and winner selection remain in
`competition_publication`.
The teaser replaces the placeholder on that Gameweek's locked Home card. It is
public before prize reveal, so keep prize-specific secrets in the separate prize fields.
Setting `content_ready` does not hide or reveal this public teaser.

The initial values below are stored in the database. New banner rows receive
matching initial copy when created. A Gameweek without a banner row uses the
same default through the public teaser projection. Schedule updates preserve
stored edits, including a cleared value. A cleared teaser falls back to “Something big is
coming... 👀”. After reveal, the card shows the prize title instead.

| Gameweek | Initial teaser |
| --- | --- |
| GW1 | The first prize is waiting... 🏓 |
| GW2 | A fresh challenge. A new reward! |
| GW3 | Your next winning moment could be close... ✨ |
| GW4 | Something big is coming... 👀 |
| GW5 | A new prize is on the horizon! 🏆 |
| GW6 | Ready for the next challenge? |
| GW7 | Something special is up for grabs... |
| GW8 | New Gameweek. New prize. 🔥 |
| GW9 | The next reward is waiting... |
| GW10 | Think you've got what it takes? |
| GW11 | Another Gameweek. Another chance to win! |
| GW12 | A little surprise is coming your way... 👀 |
| GW13 | The next prize could be yours! |
| GW14 | Make this Gameweek one to remember! 🏆 |

## Schedule the prize reveal

In `homepage_banners`, edit **`prize_reveal_at`** on the Gameweek row. Locked Home
cards show it at the bottom beside a small calendar icon, for example **Prize reveal: Thu 19 Nov · 18:00**.
Display always uses **Europe/Stockholm**, including daylight saving time; the saved
value is a `timestamptz`. Enter an explicit offset, for example
`2026-11-19 18:00:00+01:00` for Stockholm in November. Supabase may display
that same value as `2026-11-19 17:00:00+00:00` (UTC); Home shows 18:00.

The reveal migrations create missing draft rows and initialize existing rows.
The evening-default migration moves future dates still equal to the old automatic
unlock default; custom dates, cleared values and already revealed dates are preserved.
New schedule imports also create one draft row per Gameweek, including rounds
that have not been opted in as prize competitions. The initial date is **18:00
Europe/Stockholm on the calendar day after the
preceding Fantasy Gameweek's `last_match_ends_at`**, even if that round has no prize.
For example, if GW3 ends on Thursday 19 November, GW4's prize defaults to
Friday 20 November at 18:00 Swedish time (`17:00 UTC` in November). Summer dates
use the same local 18:00 time, with daylight saving handled automatically.
GW1 has no preceding Gameweek: its date is null and it follows the existing
pre-season opening rule. Season banners keep their separate publication controls.

The timestamp controls **actual prize visibility**, including Home, public detail
pages, direct database reads and artwork authorization. Moving it earlier can
reveal a prize before its normal Fantasy opening; moving it later keeps that
competition locked until the chosen time. `content_ready = true`, the Gameweek
opt-in and the global launch switch are still required. A reveal does not change
Fantasy transfer windows, scoring or results refresh requirements. Returning or
reloading Home obtains the updated state; an already-open page does not poll.

Schedule refreshes preserve saved dates, teasers, IDs, prize content and readiness.
If fixture dates change, review the prize schedule separately. Set
`prize_reveal_at = null` to restore the original Fantasy lifecycle disclosure rule,
including waiting for successful results/scoring refresh. That mode has no fixed
scheduled reveal, so the banner omits the date footer. The stored date is public before reveal, like the teaser; prize fields stay protected.
Existing signed artwork URLs retain their normal five-minute lifetime after
postponement or withdrawal.

## Weekly content in Supabase

Develop and verify locally. Hosted content editing is a human operator task in
Supabase Dashboard; staging requires explicit opt-in. Ordinary app users cannot
insert, update or delete content or upload artwork.

1. In `homepage_banners`, edit the automatically created row for the Gameweek.
   Set `prize_reveal_at` to change its reveal schedule. Do not create a separate
   teaser or reveal row.
2. Optional `title` overrides “Gameweek <number> Competition” **after reveal** (100 characters).
   Future teasers always use the generic title and gameweek number.
3. Optional `sponsor` retains the name (80 characters) for branding metadata and
   accessible image fallback text. No “Sponsored by …” line is displayed.
4. Upload an optional PNG/JPEG/WebP logo or artwork, maximum 2 MiB, to the private
   `announcement-artwork` bucket. Use a unique path, for example
   `<banner-id>/sponsor.webp`, in `image_path`; enter descriptive `image_alt`.
   The carousel contains the image without cropping, on a compact light tile.
   Bold information lines sit beside the image; no text is placed below it.
   Information remains readable when the image is absent or fails to load.
5. Optional `prize_title` (240 characters) is the headline shown on revealed Home
   banners and the competition detail page. Existing `description` values are
   preserved by the rename migration. Home shows the prize title beside the logo
   until a winner is selected; afterwards it shows the winning team with
   “Won <prize title>” underneath. Upcoming cards keep their prize title hidden.
6. Revealed weekly banners automatically link to `/competitions/gameweek/<number>`;
   season banners, including Coming soon teasers, link to `/competitions/season`. No URL entry is needed.
   Existing UUID links redirect when their number is unambiguous. Reused numbers
   retain UUID links until season-aware URLs are introduced. The unused stored `cta_url`
   column has been removed; RPC destinations remain generated.
   Linked banners retain the plain gold chevron at the right.
7. Set `content_ready = true` after reviewing the content. You can do this well
   before the reveal: database and Storage authorization enforce `prize_reveal_at`
   (or the Fantasy lifecycle when it is null).
   Set it false to withdraw content on subsequent reads. The generic competition
   card remains; revealed cards without content show “Competition details coming soon”.

Do **not** manage weekly `published`, `publish_at`, or `expires_at`.
They are retained for season scheduling; unused `sort_order` is removed. The
weekly visibility gate uses `content_ready` and `prize_reveal_at`, falling back
to Fantasy state when the date is null. There are no manually maintained
current/previous kinds.

## Season Competition in Supabase

The `season` row in `competition_publication` defaults to disabled. Existing
season choices are preserved by the centralization migration. Leave it off for this weekly-only
season. The carousel omits the entire season card, including its generic teaser.
Enabling it alongside the `global` row restores the existing season card
and publication rules without changing saved content. The season page, public
homepage promotion, direct prize/rule reads and artwork share this gate. Ordinary
Fantasy season standings are independent. See [launch controls](competition-launch.md).

Create or edit the single row with `kind = season` and `gameweek_id = null`.
Use the same optional title, sponsor, image and prize title
fields, plus the [detail-page content](competitions.md#enter-a-new-gameweek-competition-prize-in-supabase). Its default title is “Season Competition”. A crown, longer gold accent
and subtle gold court treatment distinguish it without changing the palette.

Enter approximate prize values with `prize_value_sek`; put any prize choices in
`prize_description`. Shared terms now live in versioned `competition_rules`
documents, separately for Gameweek competition and Season Competition. Approval and
automatic version assignment are described in [the content guide](competitions.md).
Do not repeat rules/eligibility on each weekly row or assume any prize is tax-free.

Season uses the existing independent publication controls:

- `published = false` keeps its content in draft.
- Set `publish_at` with an explicit timezone offset and `published = true` to
  announce immediately or later. Stockholm is +01:00 in winter and +02:00 in summer.
- Leave `expires_at = null` to keep revealed content throughout the season.
  An optional later expiry or `published = false` withdraws it.
- `content_ready` has no effect on season content.

When season competition is opted in, before publication, after withdrawal, or
without a season row, Home still shows
a generic **Coming soon** Season Competition as the final slide. It links to the
same public season placeholder page used by signed-out visitors; unpublished
prize content remains protected. Upcoming Gameweek cards retain their locks.
The season slide follows all Gameweek cards. Once published, its reveal is independent
of weekly transfer locks. A custom season title is hidden until publication.

## Authorization, payload and loading

`get_homepage_competitions()` is an authenticated, security-invoker RPC. It joins
public gameweek state to content protected by RLS, returning safe generic cards
when prize content is unreadable, alongside the public `teaser`. Narrow
security-definer projections expose only Gameweek IDs and teaser text
(`get_public_gameweek_teasers()`) or IDs, reveal times and reveal status
(`get_public_gameweek_banner_schedule()`) for enabled competitions, independently
of banner-row RLS.
The main RPC remains security-invoker and all prize reads keep their existing
RLS gates. The established RPC's unused `cta_label` output carries that teaser and the app
aliases it to `teaser`. The Home and detail RPCs use
`homepage_prize_gameweek_states()` for prize state;
RLS enforces the same timestamp or automatic Fantasy fallback. There is no
browser lifecycle calculation. Direct content requests
cannot read future weekly metadata, unready weekly rows or unrevealed season rows.
Anonymous readers can read only the granted public editorial columns of revealed
rows, and their sponsor/prize artwork. Announcement access remains authenticated.

Storage's competition policy checks the referenced banner through that same RLS.
The independent announcement policy remains unchanged. **Never reuse a published
announcement/banner object path for secret content**: any readable reference
makes the shared object readable. Use a new path when uploading embargoed artwork.
Existing signed URLs can remain usable for their five-minute lifetime after
withdrawal or schedule changes; previously seen content cannot be made secret.

A streamed Server Component performs one metadata RPC, one public-winner batch
read, one compact lookup of the latest completed Gameweek's ID/unlock time, and
one batch signing request for readable artwork. The metadata, winners and unlock
lookup run in parallel. No service-role client, persistent content cache,
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

Reveal coverage checks operator-only scheduling, early/delayed reveal across Home,
public detail and Storage, unchanged Fantasy state, generated drafts and saved-date
preservation. A rollback-only migration fixture checks next-day 18:00 defaults
across both Stockholm daylight-saving changes without starting another stack.
The existing Home browser journey checks the calendar footer and Coming soon /
Ongoing labels on mobile and desktop.

`npm run check:all` uses a disposable local stack. Populated upgrade checks verify
content/publication preservation, conservative readiness conversion, and duplicate
rejection with rollback. Functional tests exercise direct table/RPC/Storage reads,
operator-only writes, generic future cards, missing rows, Fantasy lock/refresh,
schedule changes, history and season publication. Browser coverage verifies Home
entry/re-entry/back selection, browsing without reset, desktop keyboard controls,
mobile Chromium touch swipes, reduced motion, responsive widths, missing content,
season reveal and completed fallback, with screenshots for visual inspection.

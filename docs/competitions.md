# Competitions: prizes, shared terms and discovery

Public competition pages lead with the prize name, a small competition label,
text sponsor attribution and optional prize value. Mobile artwork is contained in
a shorter frame; sponsor logos remain in the carousel, not on detail pages. Headers
reuse the carousel's blue court and gold trophy/crown styling, with extra gold for
season. Weekly standings and their winner notice share one section; season keeps
its winner notice. Approved shared terms use five independent native accordions:
Participation, Winner Selection, Winner Announcement & Claiming,
Prize Delivery, and Taxation. They start collapsed and allow multiple sections to
remain open. Optional prize conditions join Prize delivery without a separate
prize-specific subsection.
Empty `details_markdown` needs no placeholder or repetitive Gameweek content. Phase 3 remains absent: no winner confirmation,
random draw execution, award storage or automatic winner announcement.

## Publication and local preview

The entire feature is **disabled by default**. The single operator-managed row in
`competition_publication` gates routes, metadata, APIs, cards, the weekly Leagues
mode, database projections, direct banner/rule reads and competition artwork.
Read [launch and rollback instructions](competition-launch.md) before enabling it.
Local preview is an explicit opt-in in the local database, not an automatic
hostname, environment or authentication bypass. Hosted deployments never inherit
this local flag or demo content.

## Public links

- `/competitions/gameweek/5` resolves the existing Fantasy Gameweek number.
- `/competitions/season` remains the single Season Competition page.
- Existing UUID links redirect permanently (308) to the numbered page. Social metadata and canonical URLs use the numbered URL.
- No season mapping has been introduced. If multiple imported Gameweeks have the
  same number, numeric resolution returns 404 and generated links retain each
  UUID. Never choose an arbitrary row or silently redirect to another season.
  Season-aware URLs and separate season history require later work.

`competition_gameweek_routes()` reuses `round_order`, falling back to the same
chronological number used by the carousel. Internal relationships still use UUIDs.
The carousel keeps its ordering, two-teaser limit, entry selection and interaction;
only its generated destination changes. Future prize content remains embargoed.

The same competition page serves everyone. Only the header action uses the cached
verified session helper: signed-in visitors see “Back to Fantasy”; others see
“Play Fantasy” linking to signup. A small Suspense boundary keeps this session
read from blocking competition content. Internal links use Next.js navigation.
For a same-site dashboard referral with browser history, the return action uses
`router.back()` so Next can restore the previous route and scroll. Direct visits
and new tabs fall back to `/dashboard/overview`; no navigation tracker or custom
scroll storage is introduced. This referral hint changes navigation only, never
authorization or the public data projection.

## Enter a new Weekly Smash prize in Supabase

Use local Supabase for development. Hosted content publishing is a deliberate human
operator action; hosted schema changes use reviewed migrations and GitHub Actions.

1. Create one `homepage_banners` row with `kind = gameweek` and its `gameweek_id`.
2. Enter sponsor name/logo and prize information from the table below.
3. Review the content, then set `content_ready = true`. The existing Fantasy
   lifecycle controls reveal; no URL or publication date is needed for a weekly row.
4. An approved shared Weekly Smash rules version is attached automatically. Do
   not paste the same rules into every prize row. If no version is approved,
   the public page states that terms are being finalised; prize awards stay unavailable.

| Field | Editorial use |
| --- | --- |
| `title` | Optional competition title; otherwise The Weekly Smash / Season Competition |
| `sponsor` | Sponsor name |
| `image_path`, `image_alt` | Sponsor logo for carousel/discovery; absent from detail pages |
| `cta_label` | Main prize headline on the detail page (existing 40-character field) |
| `description` | Short summary for carousel/discovery and the page |
| `prize_image_path`, `prize_image_alt` | Separate, prominent prize artwork |
| `prize_description` | Full prize description; include prize choices where applicable |
| `prize_product_url` | Optional HTTPS product page; image opens it in a new tab |
| `prize_value_sek` | Optional approximate primary-prize value in SEK |
| `details_markdown` | Optional prize-specific conditions, delivery details or exceptions |
| `rules_version_id` | Automatically assigned approved shared document; retained for history |

Upload PNG/JPEG/WebP, at most 2 MiB, to the private `announcement-artwork` bucket.
Store object paths rather than URLs. Use a unique path for embargoed images:
any readable competition or announcement reference makes a shared object readable.
Artwork is batch-signed for five minutes. Withdrawal affects new reads; previously
signed URLs may work until expiry and downloaded content cannot be recalled.

Long text uses the same safe Markdown renderer as announcements: paragraphs,
bold, emphasis, lists and safe links. HTML and Markdown images are disabled.
Migration `20261101170000_simplify_competition_content.sql` removes unused
`rules_markdown`, `eligibility_markdown`, `cta_url` and `sort_order` columns from
`homepage_banners`. Any existing nonempty rules/eligibility text is preserved in
private, **unapproved** `competition_rules` drafts titled `Migrated draft: banner
<uuid>`. No migrated draft is bound or automatically published. Oversized combined
text aborts the migration for review rather than being truncated. Review these
drafts before any approval; prize-specific information belongs in `details_markdown`.
The RPC’s `rules_markdown` output still means the approved shared document body.

Migration `20261101180000_competition_product_links.sql` adds the optional
`prize_product_url` field, separate from generated internal competition links.
The database checks HTTPS format; the UI also uses the existing URL parser,
rejecting relative links, credentials, whitespace and unsafe protocols. Product
links open with `noopener noreferrer`, a subtle “View product” cue and an external
link icon. Without a valid URL or image, no product link is displayed. The existing
banner RLS and publication gates protect this field, with no authorization changes.

## Shared Weekly Smash and Season terms

`competition_rules` is one small document table with separate `kind` values:
`gameweek` for Weekly Smash and `season` for the Season Competition.

1. Create a row with a positive `version`, a descriptive `title`, and Markdown
   `body`. Leave `approved_at` empty while drafting and obtaining approval.
2. Cover participation/eligibility, scoring and tie-breaking, manual verification,
   claiming, shipping/delivery, taxation, objections/corrections and contact details.
3. Only after approval, set `approved_at` to the current timestamp.
4. Existing unbound, ready future weekly prizes pick up the approved document.
   Unbound published season content also picks up its first approved season document.
   New prizes pick the highest approved version when marked ready/published.

Approved text is immutable, even for ordinary operator updates. To change shared
terms, create a new version, edit the copy, and approve it separately. Competitions
already assigned a version keep that exact document; their pointer cannot be
reassigned. Draft prizes remain unbound until marked ready. Newly approved rules
are never automatically applied to Gameweeks whose deadlines have already passed.
An operator may explicitly attach a reviewed approved version to a previously
unbound historical competition when appropriate; this requires deliberate review.
Withdraw problematic content with its existing publication/readiness controls,
rather than deleting historical prize rows or rewriting their terms.

Approval does not by itself reveal a future document: public RLS requires an
approved version to be referenced by a revealed competition. Draft and future-only
versions are unreadable through anonymous and ordinary authenticated API requests.
Application users cannot edit, approve or assign documents. No privileged web
client or approval administration interface is introduced.

### Agreed rules and publication drafts

The agreed English body text is maintained in
[Weekly Smash](competition-rules/weekly-smash.md) and
[Season Competition](competition-rules/season-competition.md). Two **unapproved**
shared drafts were added to local Supabase: gameweek version 6 and season version 3. Historical local demo bindings to approved
versions 5/2 are preserved; the new drafts remain private and unbound.
There is no per-banner copy, new schema or hosted publication.

Both use five `##` section headings. The accordion groups presentation only;
scoring and authorization do not depend on Markdown headings. Full text and inline
links are rendered by the existing safe Markdown component. Legacy unstructured
approved content remains accessible under Participation; unknown text is preserved.

The weekly tie-break is highest net Gameweek score, highest effective captain's raw
points before multipliers/chip boosts, then a fair documented draw. The season
rules specify highest season points, highest sum of raw effective-captain points,
then a documented draw, without adding a season calculation. Claim periods start
when the notification email is sent: five calendar days weekly and ten season,
including a fresh full period for each replacement winner.

Wood House AB provides and pays for delivery. Season prize choices are the Yasaka
Progress Roller Competition table (including net/posts, approximately SEK 16,000)
or a SEK 1,800 Yasaka gift card, with no cash prize option. No tax exemption is
promised. Publication, legal/privacy checks, shared editing/versioning and remaining
product questions are documented in the [draft review guide](competition-rules/README.md).
Drafts remain hidden until separately approved; existing historical bindings do not
change. Approved terms must not be rewritten to force a preview.

## Results and provisional review

Weekly pages server-render the first five teams through the existing
`get_competition_standings` scoring RPC. “Show more teams” appends up to 25 entries
per request through a public, no-store endpoint with validated UUID and offset.
Ranks come directly from the backend, preserving ties. A debounced team-name search
above the compact competition table searches all eligible scored teams, not just
the five initial rows. Matching teams retain their original ranks; clearing search
returns to the previous unfiltered view.

`/dashboard/leagues` and `/dashboard/leagues/global` have Season/Gameweek controls
styled like the squad view switch. Both modes reuse `LeagueTable`, including
responsive cards/table, search,
show-more pagination, manager display names, own-position highlighting and team
previews. In Gameweek mode, a team preview opens on the selected round and points
are labelled as Gameweek points. The first ten entries plus the manager's own row
match the global view's initial behavior. Gameweek mode defaults to the most recent
started round, falling back to the earliest scheduled round when none has started.
Left/right arrows select the previous/next scheduled Gameweek, including those not
started, and a link opens its canonical Weekly Smash page directly. Avoid UUID
redirects for these internal links: redirects can lose the dashboard referral used
for returning to the previous route and scroll. Query parameters retain the
selected view/Gameweek across navigation. Private
league membership, tables and authorization are unchanged.

Migration `20261101190000_gameweek_leaderboard_search.sql` adds the optional
`p_search` argument to `get_competition_standings` and an authenticated-only
`get_gameweek_leaderboard` projection for existing team-preview identifiers and
profile display names. Both use the same existing valid-snapshot entry helper and
stored scores. Search filters after ranking, uses literal case-insensitive name
matching, and paginates in SQL. The public projection still excludes account IDs,
profile names and squads. No table, scoring rules or RLS policy changes.

Public competition standings show rank, locked Fantasy team name and net Gameweek
points only. They
are explicitly provisional; incomplete results, no scores, pre-kickoff and fetch
errors have distinct messages. Winner verification remains a separate step. The
season page retains a generic winner notice without a season calculation.

The existing scoring and private provisional-review infrastructure remain
unchanged. The original snapshot operation establishes deadline eligibility;
current clubs/prices/activity do not invalidate historical squads.

Operators can inspect a Gameweek using:

```sql
select public.get_weekly_competition_review('<gameweek-uuid>'::uuid);
```

This read-only function remains restricted to trusted operators/service role.
It returns all top net-score teams and remaining prize candidates after comparing
raw effective-captain points. Captain substitution uses the existing ordered pairing
of absent starters and playing bench players. No replacement means zero captain
points. An 80-point team with 16 raw captain points beats an 80-point team with
12 raw points and Triple Captain. The public table keeps shared score ranks; it does not publish the provisional prize selection.

Missing scores, outstanding fixtures and refresh state are reported separately.
`data_refreshed_at` does not guarantee final upstream results; later imports can
still change scores. The review always reports `award_enabled = false`.

## Public homepage promotion

Signed-out `/` and `/en` visitors see two compact entry points beneath the signup
CTA, using the current Weekly Smash (latest completed if no current round) and the
independently scheduled Season Competition. Missing content uses generic copy;
with no Gameweeks, only season is shown. The entire card links to the public page.
The existing signup action and dashboard carousel remain available unchanged.

`get_public_competition_promotions()` reuses the detail-page projection and the
same RLS reveal rules. It returns only compact published fields, never long rules,
private data or unrevealed sponsor/prize metadata. There is one metadata request
and one batch artwork-signing request, without polling or persistent content caching.
Signed-in users continue to redirect to their dashboard before promotions load.

## Validation and Phase 3

`npm run check:all` uses a disposable local stack. Coverage includes immutable
approved documents, automatic version assignment, historical retention, separate
season rules, RLS/embargoes, numbered routes and ambiguity, UUID redirects, public
promotions, safe product URLs and unchanged Fantasy scoring/announcement/carousel
behavior. Focused regression journeys cover the initial five rows, ranked search,
loading more teams, retrying failed searches, Season/Gameweek controls, round
arrows, own-position rows and team previews, shared guest/signed-in content,
dashboard return navigation and optional terms. Section parsing has focused unit
coverage for text/link preservation, legacy content and fenced Markdown. Populated cleanup tests preserve
private legacy drafts and reject oversized text without partial changes. Browser
screenshots require capture and visual inspection through `$verify-ui`.

Phase 3 still requires separate approval: protected winner confirmation and draw
records, an immutable published decision, atomic publication of one existing
announcement, and a seven-day popup window with retained inbox history. No winner
confirmation or announcement action is introduced here.

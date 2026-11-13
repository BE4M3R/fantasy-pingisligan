# Competitions: prizes, shared terms and discovery

Public competition pages lead with the prize title, a small competition label,
text sponsor attribution and optional prize value. Mobile artwork is contained in
a shorter frame; per-prize sponsor logos remain in the carousel. Headers
reuse the carousel's blue court and gold trophy/crown styling, with extra gold for
season. The header uses the existing brand mark and wordmark images. Weekly
and Season competition headers show a larger Yasaka wordmark from
`public/branding/yasaka-www-grey.png`, with no sponsor caption. Its transparent
canvas padding is clipped in the header while the supplied file stays intact. Our icon sits above
the wordmark on the left, Yasaka sits directly beside it and is vertically centered,
and a compact return action sits
on the right on every viewport. Winners
use a centered celebration card with static gold/blue confetti in the corners;
the winner card has no trophy, points or confirmation-status line. Pending notices stay plain.
Weekly pages show a Competition leaderboard and a dedicated winner box above the prize
when an operator selects a winner. Completed Gameweeks without a selection show
a pending announcement notice. The Rules tab and public `/rules` page contain the approved
shared terms in one “Competition rules and policy” section. It shows the latest
approved Gameweek policy and, when enabled, the latest approved Season policy. Each
document uses four independent native accordions:
Participation, Winner Selection, Winner Announcement & Claiming,
and Taxation. They start collapsed and allow multiple sections to
remain open. Delivery text in older documents is grouped with claiming.
There is no prize-specific section; legacy `details_markdown` is retained in storage
but is not fetched or displayed by the Rules page. A manual `competition_winner` team reference on each Gameweek publication row
publishes to the competition page and Home banner. Email, social posts, prize fulfilment and inbox/popups remain separate.

## Publication and local preview

Public competition pages and prizes are **disabled by default**. Operator-managed rows in
`competition_publication` gate competition routes, metadata, public competition
APIs, cards, prize projections, direct banner/rule reads and competition artwork.
Signed-in Season/Gameweek Leagues standings remain available independently; only
their links to competition pages require publication and an opted-in prize round.
`competition_publication` now has `global`, `season`, and linked gameweek rows,
each with an `enabled` switch. Keep season false for this weekly-only season.
Gameweek `homepage_banners` rows hold an editable public `teaser` for locked Home cards;
see [teaser copy](homepage-banners.md#edit-a-gameweek-teaser).
New gameweeks automatically receive disabled rows; enable the chosen gameweek
rows alongside global. Season/global choices and existing per-round selections
are preserved. No content is deleted by toggling; direct prize/rule/artwork reads
share the same gates, while ordinary standings remain independent.
Excluded rounds have no prize page, carousel card or public promotion; their
Fantasy results and Gameweek numbers stay unchanged.
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
The carousel keeps its ordering, entry selection and interaction;
only its generated destination changes. Future prize content remains embargoed.

The same competition layout serves everyone. Accounts with an explicit preview
permission can read unrevealed ready prizes as described below. The header action uses the cached
verified session helper: signed-in visitors see “Back to Fantasy”; others see
“Play Fantasy” linking to signup. A small Suspense boundary keeps this session
read from blocking competition content. Internal links use Next.js navigation.
For a same-site dashboard referral with browser history, the return action uses
`router.back()` so Next can restore the previous route and scroll. Direct visits
and new tabs fall back to `/dashboard/overview`; no navigation tracker or custom
scroll storage is introduced. This referral hint changes navigation only, never
authorization or the public data projection.

## Account-specific preview before reveal

After migration `20261113120000_account_competition_preview.sql` is deployed,
open **Supabase Studio → Table Editor → profiles**, find your account by its Auth
user ID, and set **`can_preview_competitions = true`**. It defaults to false for
every existing and new account. Ordinary application users cannot change it;
signup metadata does not grant permission.

While signed in to that account, open the normal URL, for example
`/competitions/gameweek/5`. Ready prize text, product links and prize artwork
appear before the scheduled reveal. Anonymous visitors and accounts without the
permission keep seeing the public placeholder. Reload after granting or revoking
the permission; no logout or new sign-in is needed.

Global and the matching Gameweek publication switch must still be enabled, and
the banner must have `content_ready = true`. Season previews require global and
season enabled plus a `published` season banner that has not expired; they bypass
its future `publish_at`. Draft/unready prizes and draft rules stay private.
Standings and winner announcements retain their ordinary public timing rules.

The Home banner, links, promotions, social metadata and public prize projections
continue to follow the scheduled reveal, including for the preview account.
Only page content uses the authenticated `get_competition_preview()` projection;
prize artwork has a matching account-checked Storage policy. The app never uses a
service-role client. Preview responses depend on the session and are not shared
through a persistent application cache.

Set the account flag back to false to revoke preview access. Existing downloaded
content cannot be recalled, and previously signed image URLs may remain usable
for their five-minute lifetime. No Vercel variables are required. Hosted migrations
follow the normal reviewed `develop` → staging → `main` release process; the
account permission is a separate operator edit in each environment.

## Enter a new Gameweek competition prize in Supabase

First enable the chosen Gameweek row in `competition_publication`.
Keep unconfirmed prize rounds false; no banner row is required just to choose a
round. Then prepare its optional prize content below.

Use local Supabase for development. Hosted content publishing is a deliberate human
operator action; hosted schema changes use reviewed migrations and GitHub Actions.

1. Edit the automatically created `homepage_banners` row for its `gameweek_id`.
2. Enter sponsor name/logo and prize information from the table below.
3. Review the content, then set `content_ready = true`. `prize_reveal_at` controls
   the actual prize reveal and defaults to 18:00 Stockholm time on the day after
   the preceding Gameweek's final scheduled match. Edit it to move the reveal, or
   clear it to restore the original Fantasy lifecycle gate. No URL is needed.
   See [reveal scheduling](homepage-banners.md#schedule-the-prize-reveal).
4. An approved shared Gameweek competition rules version is attached automatically. Do
   not paste the same rules into every prize row. If no version is approved,
   the public page states that terms are being finalised; prize awards stay unavailable.

| Field | Editorial use |
| --- | --- |
| `title` | Optional competition title; otherwise Gameweek <number> Competition / Season Competition |
| `prize_reveal_at` | Editable timestamp controlling prize visibility; displayed with a calendar icon on Coming soon Home banners in Stockholm time |
| `teaser` | Public text on locked Gameweek Home cards, readable before prize reveal regardless of `content_ready` |
| `sponsor` | Sponsor name |
| `image_path`, `image_alt` | Sponsor logo for carousel/discovery; absent from detail pages |
| `prize_title` | Prize headline on revealed Home banners and the competition detail page; winner banners show it below the team name as “Won <prize title>” |
| `prize_image_path`, `prize_image_alt` | Separate, prominent prize artwork |
| `prize_description` | Full prize description; include prize choices where applicable |
| `prize_product_url` | Optional HTTPS product page; image opens it in a new tab |
| `prize_value_sek` | Optional approximate primary-prize value in SEK |
| `details_markdown` | Legacy prize-specific notes; retained in storage, not displayed |
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
Migration `20261110230000_remove_banner_cta_label.sql` copies an old headline to
`description` only when the latter is empty, then removes the redundant banner
`cta_label` column. The established RPC output shapes stay compatible while the
carousel and detail page originally used `description`. Forward migration
`20261111180000_banner_prize_title.sql` renames that column to `prize_title`,
preserving its existing text and grants. Migration
`20261112120000_home_banner_prize_titles.sql` also returns that headline through
the Home RPC's existing `description` output, aliased to `prize_title` by the app.
Home shows the prize title before a winner is selected, and the winning team with
“Won <prize title>” afterwards. Public landing cards use the generic View competition label;
their compact RPC does not return the editorial prize title.

Migration `20261101180000_competition_product_links.sql` adds the optional
`prize_product_url` field, separate from generated internal competition links.
The database checks HTTPS format; the UI also uses the existing URL parser,
rejecting relative links, credentials, whitespace and unsafe protocols. Product
links open with `noopener noreferrer`, a subtle “View product” cue and an external
link icon. Without a valid URL or image, no product link is displayed. The existing
banner RLS and publication gates protect this field, with no authorization changes.

## Shared Gameweek competition and Season terms

`competition_rules` is one small document table with separate `kind` values:
`gameweek` for Gameweek competition and `season` for the Season Competition.

1. Create a row with a positive `version`, a descriptive `title`, and Markdown
   `body`. Leave `approved_at` empty while drafting and obtaining approval.
2. Cover participation/eligibility, scoring and tie-breaking, manual verification,
   claiming, shipping/delivery, taxation, objections/corrections and contact details.
3. Only after approval, set `approved_at` to the current timestamp.
   The latest approved version appears on Rules on the next reload, provided
   the global competition switch is enabled; Season also requires its switch.
   A prize binding is not required for the shared Rules page.
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

The shared `get_current_competition_rules()` projection returns at most one
approved document per enabled kind, independently of prize timing and bindings.
It uses a narrowly scoped security-definer function to publish this approved
policy. Direct document-table reads keep their existing revealed-prize RLS,
and competition detail RPCs retain each prize's original version. Drafts are
never returned by the shared-policy projection.
Application users cannot edit, approve or assign documents. No privileged web
client or approval administration interface is introduced.

### Agreed rules and publication drafts

The agreed English body text is maintained in
[Gameweek competition](competition-rules/gameweek-competition.md) and
[Season Competition](competition-rules/season-competition.md). Two **unapproved**
shared drafts were added to local Supabase: gameweek version 6 and season version 3. Historical local demo bindings to approved
versions 5/2 are preserved; the new drafts remain private and unbound.
The authoring files do not publish content to hosted environments or create
per-banner copies. Shared-policy publication uses the forward migration
`20261111110000_current_competition_rules.sql`.

The revised Gameweek draft uses four `##` section headings. Legacy Prize delivery
headings in older documents are folded into Winner Announcement & Claiming.
The accordion groups presentation only;
scoring and authorization do not depend on Markdown headings. Full text and inline
links are rendered by the existing safe Markdown component. Legacy unstructured
approved content remains accessible under Participation; unknown text is preserved.

The revised weekly draft uses highest net Gameweek score, highest effective captain's raw
points before multipliers/chip boosts, highest season position, then a random draw. The season
rules specify highest season points, highest sum of raw effective-captain points,
then a documented draw, without adding a season calculation. Claim periods start
when the notification email is sent: five days weekly and ten season.

The shortened Gameweek copy was approved locally as version 7. Publishing a
shared policy does not rewrite historical prize bindings. The competition
leaderboard and provisional-review helper compare Gameweek points, raw captain
points and cumulative season points through that Gameweek. Later rounds are
excluded from that season comparison; corrections within the period still apply.

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
Ranks come directly from the backend: net Gameweek points, raw effective-captain
points without multipliers, then cumulative season points through this Gameweek.
The last comparison represents season position after this round and before the
next. A complete tie shares a rank for a later manual draw; alphabetical ordering
within that shared rank only makes pagination stable and selects no winner.
A debounced team-name search
above the compact competition table searches all eligible scored teams, not just
the five initial rows. Matching teams retain their original ranks; clearing search
returns to the previous unfiltered view.

`/dashboard/leagues` and `/dashboard/leagues/global` have Season/Gameweek controls
styled like the squad view switch. Both modes reuse `LeagueTable`, including
responsive cards/table, search,
show-more pagination, manager display names, own-position highlighting and team
previews. In Gameweek mode, a team preview opens on the selected round and points
are labelled as Gameweek points. The first five entries plus the manager's own row
match the global view's initial behavior. Gameweek mode defaults to the most recent
started round, falling back to the earliest scheduled round when none has started.
Left/right arrows select the previous/next scheduled Gameweek, including those not
started. A competition link appears only for an ongoing round (including its
pending results refresh) or the most recently completed round, and only when
that prize competition is enabled. Older completed and future rounds have no
competition link in this view. The link opens its canonical competition page directly. Avoid UUID
redirects for these internal links: redirects can lose the dashboard referral used
for returning to the previous route and scroll. Query parameters retain the
selected view/Gameweek across navigation. Private
league membership, tables and authorization are unchanged.
Switches and round arrows fetch only the standings panel, without reloading the
page or scrolling to the top. The previous table remains visible while loading,
and retained panel height prevents scroll jumps when a round has fewer rows.
Native history updates preserve the URL, unrelated query parameters and browser
Back/Forward navigation. Compact views are cached in the mounted panel for 30
seconds (at most 16 entries); older requests are cancelled when selection changes.
An authenticated, private/no-store `/api/league-standings` read shares the initial
server loader, including the manager's own row and competition publication gates.

Migration `20261101190000_gameweek_leaderboard_search.sql` adds the optional
`p_search` argument to `get_competition_standings` and an authenticated-only
`get_gameweek_leaderboard` projection for existing team-preview identifiers and
profile display names. Both use the same existing valid-snapshot entry helper and
stored scores. Search filters after ranking, uses literal case-insensitive name
matching, and paginates in SQL. The public projection still excludes account IDs,
profile names and squads. No table, scoring rules or RLS policy changes.

Public competition standings show rank, locked Fantasy team name and net Gameweek
points only. They are explicitly provisional; incomplete results, no scores, pre-kickoff and fetch
errors have distinct messages. The leaderboard has no Provisional badge, and the
prize header has no lifecycle badge. Leagues Gameweek navigation omits
“Provisional results” and the provisional qualifier on in-progress rounds.
Winner verification remains a separate step. The
selected winner's box sits above the prize and remains independent of leaderboard
search, pagination and ranking. The season prize page has no winner notice.

The public board and private provisional review reuse
`private.weekly_competition_rankings()` from migration
`20261111120000_competition_leaderboard_tiebreaks.sql`. Ordinary Fantasy league
standings still rank by points alone. The original snapshot operation establishes deadline eligibility;
current clubs/prices/activity do not invalidate historical squads.

Operators can inspect a Gameweek using:

```sql
select public.get_weekly_competition_review('<gameweek-uuid>'::uuid);
```

This read-only function remains restricted to trusted operators/service role.
It returns all top net-score teams and remaining prize candidates after comparing
raw effective-captain points and historical season totals. Captain substitution uses the existing ordered pairing
of absent starters and playing bench players. No replacement means zero captain
points. An 80-point team with 16 raw captain points beats an 80-point team with
12 raw points and Triple Captain. Equal captain scores are compared by cumulative
season points through the selected Gameweek. Only teams still equal after that
share the competition rank and remain candidates for a manual draw.

Missing scores, outstanding fixtures and refresh state are reported separately.
`data_refreshed_at` does not guarantee final upstream results; later imports can
still change scores. The review always reports `award_enabled = false`.

## Choose a Gameweek winner in Table Editor

Open **Supabase → Table Editor → public → competition_publication**. Find the row
named **Gameweek <number> competition** and edit **competition_winner**:

- Select the linked row from `fantasy_teams`, or paste that team's `id`.
- Save to announce that team on the competition page and Home banner.
- Change the team to replace the winner.
- Clear the value to `NULL` to remove the announcement.

The `global` row and the chosen Gameweek row must both have `enabled = true`.
Winner selection belongs on Gameweek rows, not the `global` or `season` rows.
A future Gameweek still marked `upcoming` stays embargoed until its normal reveal.
For a revealed Gameweek, selecting a winner is the publishing action: it does
not require a SQL function, approved prize rules, a ready banner, completed
fixtures, a squad snapshot, a successful refresh or a particular leaderboard
position. The operator is responsible for deciding the winner and publication
time. Leave the column empty until ready to announce.

The column is a nullable foreign key to `fantasy_teams.id`, preventing references
to nonexistent teams. The website displays the selected team's current name;
the Home banner also shows the prize it won. The public projection retains optional
stored points, but the winner card and banner omit points. A team without a
stored score still appears. Renaming the team updates its displayed
name; deleting it clears its winner reference. No email, account/team UUID,
manager profile, delivery address or squad is included in the public response.

`get_public_competition_winners` is a read-only projection, returning the public
Gameweek UUID, selected team name and optional points. Home loads all public
winner choices in one fresh batch; detail pages filter by Gameweek. The most
recently completed Gameweek's winner leads Home on entry only until 48 hours
after that Gameweek's `unlock_at`; afterwards, or without a winner, Home selects
the current competition. Older winner cards remain browsable. Reload or return to the page
to see edits. Landing-page promotions retain their existing current-prize behavior.

Migration `20261111160000_manual_competition_winner.sql` replaces the initial
confirmation prototype with this field. It preserves any published prototype
choice, then removes the private decision table, confirmation/withdrawal/draw
functions and scoring-invalidation triggers. The earlier migration remains as
schema history. There is no automatic selection, draw, ranking validation or
score-change withdrawal. Existing Fantasy scoring and leaderboard tie-breaks
remain unchanged; later score changes update the displayed points without
changing the operator's chosen team.

Ordinary visitors and managers cannot write publication rows or read the private
team reference directly. The web application uses its existing unprivileged
Supabase clients. Email, social posts and prize fulfilment remain manual; the
five-day claim period starts when the email is actually sent. Existing inbox,
popups and Season winner selection are unchanged.

## Public homepage promotion

Signed-out `/` and `/en` visitors see the nearest enabled Gameweek competition
whose entry deadline (`lock_at`) has not passed, alongside the independently
enabled Season Competition. An already-open round qualifies; closed/completed
rounds and disabled competitions are skipped. At the deadline, the weekly card
automatically moves to the next eligible prize round. With no eligible round,
only the season card appears if enabled; otherwise no competition card appears.

Before prize reveal, the weekly card shows its generic Gameweek title, public
teaser and scheduled reveal date (Stockholm time). Ready, revealed prizes show
their prize title and optional value. The start-page cards omit sponsor names and
artwork. A bordered header above the cards reads “Compete for exciting Gameweek
prizes every week!” (localized in Swedish), with competition details below
and each arrow in the bottom-right corner. Two cards stack on phones and share
a row from the small breakpoint.
The entire card links to the ordinary competition page. The signup action stays
prominent above these promotions, with the static Yasaka sponsorship caption and
logo directly beneath it, independently of competition publication switches.
Account preview permissions never publish
prizes on this anonymous start page.

`get_public_competition_promotions()` reuses the detail-page projection and the
same RLS reveal rules. It returns only compact published fields, never long rules,
private data or unrevealed sponsor/prize metadata. Its legacy `description` field
contains only the public teaser before reveal; `prize_reveal_at` supplies the
scheduled date without extra application queries. There is one metadata request
without artwork signing, polling or persistent content caching.
Signed-in users continue to redirect to their dashboard before promotions load.

## Validation and remaining delivery work

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

Winner regression coverage covers selecting a team without ranking or score
prerequisites, replacement, clearing, deletion, score changes, publication gates,
future embargoes, write permissions and private identifiers. The browser journey
uses the same publication-row edits as Table Editor, covering the winner box,
Home banner, withdrawal and mobile/desktop overflow. Email/social delivery and
claim tracking remain outside this feature.

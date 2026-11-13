# Announcements

Announcements provide rare, important English in-app news for signed-in dashboard
users: major updates, rule changes and service disruptions. Recurring gameweek
competitions, sponsors and prizes belong in the Gameweek competition carousel.
Content is shared; read/dismissal state belongs to each user. There is
no admin interface, email/push delivery, polling, realtime subscription or
publication cron.

## Publishing through Supabase

Schema and Storage policies come from the forward migration. Develop and verify
content on local Supabase first; staging is an explicit opt-in. Production
publishing is a human operator task using the appropriate Supabase Dashboard,
separate from the everyday development identity. Do not put production write
credentials in the application or run local scripts against production.

1. In Table Editor, create an `announcements` row with `published = false`.
2. Enter `title` and `body` in English. Body supports paragraphs, **bold**,
   *emphasis*, lists and links. HTML and Markdown images are disabled. Put images
   in the dedicated artwork field instead.
3. Use `category`: `news` (default). Existing `sponsor` content remains readable;
   publish recurring promotions through the Gameweek competition carousel. Artwork retains
   its original background; transparent images use the navy surround. Priority
   is separate: `normal` (default) or `high`. Reserve High for
   rare urgent operational notices.
4. Optionally upload a PNG, JPEG or WebP (maximum 2 MiB) to the private
   `announcement-artwork` Storage bucket. Use a unique path, for example
   `<announcement-id>/prize.webp`. Put that path, without bucket name or URL, in
   `image_path`, and descriptive text in `image_alt`. Do not reuse artwork paths
   for embargoed campaigns: a path referenced by published content is accessible.
   Uploads are operator-only; application users cannot upload or edit artwork.
   Artwork is centered and contained without cropping, capped at 176px high
   (less on short phones). Landscape banners, square products and logos use the
   same rules in popups and inbox details. Upload a tightly framed image when
   possible: white margins embedded in the file cannot be removed by layout CSS.
   Dark logos should include a contrasting background in the uploaded file;
   transparent images sit on navy. The app does not infer logo colors or crop files.
5. Optionally set both `cta_label` and `cta_url`. Links accept application paths
   such as `/dashboard/rules`, or HTTPS URLs. Do not use protocol-relative URLs,
   credentials in URLs, whitespace or backslashes.
6. Set `publish_at` to an explicit timestamp with a timezone offset, for example
   `2026-11-01T09:00:00+01:00`. Stockholm uses +01:00 in winter and +02:00 in
   summer. Check the Dashboard's timezone display and the stored instant, especially
   around daylight-saving transitions; avoid ambiguous local times.
7. Set `popup_enabled = true` if this should appear automatically. Otherwise it
   appears only in the inbox. Set optional `popup_until` after `publish_at` to
   end automatic promotion while preserving inbox history.
8. Review all fields, then set `published = true`. If `publish_at` is in the
   future, both content and artwork remain unavailable to ordinary readers until
   that time. No deploy or job is required. An already-open app discovers content
   on opening/return, not at the exact publication instant.

Set `published = false` to withdraw an item from ordinary readers. Editing a
published announcement never resets anyone's dismissal. Publish a new row when
users need to acknowledge a materially new notice. Keep historical rows and
artwork; do not delete them as routine cleanup. Existing signed artwork links
can remain usable for their five-minute lifetime after withdrawal.

### Preview with a selected account

In Supabase Table Editor, find the account's row in `profiles` by its Auth user
ID and set `can_preview_announcements = true`. This operator-only boolean is
separate from `can_preview_competitions` and defaults to false for every account.
Users cannot enable it through signup metadata or profile updates.

Keep the announcement's `published = false` while editing. Sign in with the
selected account and reload the dashboard: draft and future-scheduled
announcements appear in its ordinary inbox and unread count, with private
artwork. Set `popup_enabled = true` to test the automatic popup too;
`popup_until` still controls popup expiry. Other accounts see only published,
due announcements. The permission covers all announcements, rather than one
selected draft, and never enables competition previews.

Read and dismissal state is saved normally for the preview account. A dismissed
draft remains in its inbox and does not replay automatically when published;
other users' state is unaffected. Publish normally when ready. Set the profile
boolean back to false to remove preview access; already signed artwork links
can remain usable for their five-minute lifetime. Hosted schema changes use the
normal migration workflow before this field is available.

### Field choices in Table Editor

| Field | Values |
| --- | --- |
| `category` | `news`, `sponsor` |
| `priority` | `normal`, `high` |
| `published` | `false` (draft), `true` (publish at `publish_at`) |
| `popup_enabled` | `false` (inbox only), `true` (automatic popup and inbox) |

Category and priority are currently text fields with database checks. Enter the
lowercase value; the checks do not create a choices dropdown in Studio. Enum
columns can provide dropdowns, but require a schema migration. This UI/behavior
update keeps the schema unchanged. Legacy `update` and `important` rows remain
readable and use the News presentation; use News for new announcements.

## Reader behavior

The header bell opens a full-height notification center on phones and a compact,
non-modal panel beneath the bell on desktop. Cards show category, a plain-text
message preview, publication date and unread state. Full content opens inside
the same panel with an All announcements back action. Desktop outside clicks
and Escape close the panel; the page and unsaved squad changes stay in place.

Automatic announcements use a compact centered modal, approximately 90% of the
phone's width and at most 85% of the viewport height, with the Fantasy page
visible behind a darkened background. Long content scrolls within the modal;
the top-right X remains visible. Both views use the same content renderer.

High popups precede Normal popups; each group is oldest first, with UUID as the
stable tie-breaker. The X, an outside click/tap or Escape saves the current
announcement's read and dismissal timestamps before advancing. Clicking inside
the popup does not dismiss it. Progress appears when there are multiple items.
Clicking a popup link saves its dismissal before following the link. A failed
save keeps the current item open with an error and Retry action. Opening inbox
details marks read without dismissing; opening the list alone does neither.

After a successful popup dismissal, the popup shrinks and curves toward the
header's notification bell over 480ms, then the bell briefly highlights. The next
popup waits until that animation finishes. Reduced-motion users skip the flight;
an off-screen bell also skips it without moving the page. The bell's unread badge
stays visible for 1.4 seconds after the update, then fades over 320ms only when
more than one unread announcement remains. A count of one stays visible.
Opening the inbox reveals the badge again, and a changed unread count also
reveals it. The fade changes presentation only: unread/read/dismissal state and
the bell's accessible unread label retain their existing behavior.

Each notice requires individual dismissal. There are no cooldowns or snoozing.
Dismissals persist per user across devices; dismissed notices remain in the inbox
and never appear automatically again.

The shared dashboard layout preserves the queue during navigation. Reloading
reconstructs remaining items from database state; progress counters can restart.
Database dismissals prevent completed items from replaying; no session-storage
completion flag suppresses announcements published later in the same login.
New users see all currently popup-eligible items after team
onboarding. Other open dialogs defer automatic announcements until they close.

Returns refresh eligibility and unread counts; other devices' changes are
observed at these checks, not streamed live. No automatic popup replaces an
announcement currently being read. Newly discovered items join the pending queue
in priority order after it. Returning after a completed or initially empty visit
checks new content without requiring the inbox or a fresh login. The inbox always
offers published history, including expired promotions.

## Implementation and verification

`announcements` holds content. `announcement_user_state` stores sparse per-user
read/dismissal timestamps; only the interaction RPC can write them, and it never
clears a dismissal. The legacy `announcement_user_preferences` table and
`snooze_announcements` RPC remain unused for compatibility; existing snoozes have
no effect. No schema cleanup migration is required to change popup behavior.
RLS guards publication and owner-only reads even through direct API
access. No privileged application client is needed. The summary RPC returns
unread count and candidate metadata without bodies or archive rows. Its legacy
`snoozed_until` and `checked_at` fields are ignored by the application.
Inbox pages load in batches of 20, including body text for previews. Full Markdown
rendering and short-lived artwork URLs load when an item opens. No shared cache
contains authenticated state.

Browser journeys cover account preview, popup order, saved dismissals, failure/retry,
the flight to the bell, delayed multi-unread badge fading, the persistent single
unread badge and reduced-motion queue advancement. Functional tests verify
preview account isolation, blocked self-grants, private Storage, permission
revocation and saved dismissals across publication.
Follow [rendered inspection](automated-testing.md#rendered-ui-inspection)
and `$verify-ui`; screenshot assertions alone are insufficient.

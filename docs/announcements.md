# Announcements

Phase 1 provides English in-app announcements for signed-in dashboard users.
Content is shared; read/dismissal and snooze state belong to each user. There is
no admin interface, email/push delivery, polling, realtime subscription or
publication cron. Competition pages are a separate future feature.

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
3. Use `category`: `news` (default) or `sponsor`.
   Sponsor content uses the same layout with a sponsor label. Artwork retains
   its original background; transparent images use the navy surround. Priority
   is separate: `normal` (default) or `high`. Reserve High for
   rare urgent operational notices; ordinary sponsor promotions should be Normal.
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
   future, both content and artwork remain unavailable until that time. No deploy
   or job is required. An already-open app discovers content on opening/return,
   not at the exact publication instant.

Set `published = false` to withdraw an item from subsequent reads. Editing a
published announcement never resets anyone's dismissal. Publish a new row when
users need to acknowledge a materially new notice. Keep historical rows and
artwork; do not delete them as routine cleanup. Existing signed artwork links
can remain usable for their five-minute lifetime after withdrawal.

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
readable and use the News presentation; use only News/Sponsor for new content.

## Reader behavior

The header bell opens a full-height notification center on phones and a compact,
non-modal panel beneath the bell on desktop. Cards show category, a plain-text
message preview, publication date and unread state. Full content opens inside
the same panel with an All announcements back action. Desktop outside clicks
and Escape close the panel; the page and unsaved squad changes stay in place.

Automatic announcements use a compact centered modal, approximately 90% of the
phone's width and at most 85% of the viewport height, with the Fantasy page
visible behind it. Long content scrolls within the modal; dismissal and snooze
controls remain visible at its bottom. Both views use the same content renderer.

High popups precede Normal popups; each group is oldest first, with UUID as the
stable tie-breaker. Dismiss/continue saves the read and dismissal timestamps
before advancing. Escape dismisses the current popup too. Clicking a popup link
saves its dismissal before following the link. A failed save keeps the current
item open and retryable. Opening inbox details marks read without dismissing;
opening the list alone does neither.

High notices require individual dismissal. Once no High remains, “Skip remaining
for 24 hours” saves a user-wide Normal snooze using database time. It does not
mark unseen notices read or dismissed. High notices bypass that pause. A return
after the pause can resume remaining Normal items, including in the same tab.

The shared dashboard layout preserves the queue during navigation. Reloading
reconstructs remaining items from database state; progress counters can restart.
Database dismissals prevent completed items from replaying; no session-storage
completion flag suppresses announcements published later in the same login.
New users see all currently popup-eligible items after team
onboarding. Other open dialogs defer automatic announcements until they close.

Returns refresh eligibility and unread counts; other devices' changes are
observed at these checks, not streamed live. No automatic popup replaces an
announcement currently being read. New High items follow it; newly published
Normal items wait until the next opening/return once the current Normal batch is
selected. Returning after a completed or initially empty visit checks new content
without requiring the inbox or a fresh login. The inbox always offers published
history, including expired promotions.

## Implementation and verification

`announcements` holds content. `announcement_user_state` stores sparse per-user
read/dismissal timestamps; only the interaction RPC can write them, and it never
clears a dismissal. `announcement_user_preferences` contains the private snooze
deadline. RLS guards publication and owner-only reads even through direct API
access. No privileged application client is needed. The summary RPC returns
unread count, candidate metadata and snooze time without bodies or archive rows.
Inbox pages load in batches of 20, including body text for previews. Full Markdown
rendering and short-lived artwork URLs load when an item opens. No shared cache
contains authenticated state.

Run `npm run check:all` on the disposable local stack. Announcement unit,
functional and browser tests cover priority, link safety, publication, RLS,
private Storage, irreversible dismissals, snooze, inbox read state, navigation,
reload and responsive views. Follow [rendered inspection](automated-testing.md#rendered-ui-inspection)
and `$verify-ui`; screenshot assertions alone are insufficient.

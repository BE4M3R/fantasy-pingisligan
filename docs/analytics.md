# Web Analytics

Pingisligan Fantasy uses the installed `@vercel/analytics` package. The shared
`app/document-layout.tsx` mounts `ProductionAnalytics` once for either the Swedish
or English root. Its single `Analytics` from `@vercel/analytics/next` handles
initial page views and Next.js client navigation. There are no custom page-view
events, analytics providers, database writes or additional dependencies.

## Production boundary

- The server renders the integration only when `VERCEL_ENV=production`.
- `next.config.ts` derives `NEXT_PUBLIC_ANALYTICS_ENABLED` from `VERCEL_ENV` at
  build time. It is not a manually maintained environment variable.
- The client requires that flag **and** the exact origin
  `https://pingisliganfantasy.se` before mounting `Analytics` or calling `track()`.
- `beforeSendAnalytics` repeats the same gate for both page views and events.
  Localhost, preview, staging and deployment-specific `*.vercel.app` URLs do not
  load the analytics script or dispatch custom events, including production-mode
  local builds. `NODE_ENV` is not the tracking permission.
- The existing local/staging environment loaders and Supabase boundaries are
  unchanged. No credentials or analytics keys are needed.

## Anonymous grouping

`lib/analytics.ts` defines a closed union of feature event names. The tracking
helper accepts **no properties**, so every event has zero custom properties
(within the requested Pro limit of two). No player, manager, user, team, email,
league, invitation, product URL or search text is supplied to `track()`.

The shared `beforeSend` hook redacts the URL on both page views and custom events:

| Actual page | Reported path |
| --- | --- |
| Known static page such as `/dashboard/overview` | Same path |
| `/dashboard/leagues/<any identifier>` | `/dashboard/leagues/[leagueId]` |
| `/competitions/gameweek/<number or identifier>` | `/competitions/gameweek/[gameweekId]` |

All query strings and fragments are removed, including invite codes, auth values,
messages, gameweek selectors and return destinations. Unknown paths are dropped.
When adding a page, update the explicit static-path allowlist or add a redacted
route pattern. API requests and auth callback endpoints are not page views.
Statistics and squad previews are dialogs; their usage is counted by the feature
events below, rather than invented page views. Analytics errors are caught by
the helper and cannot stop the underlying action.

## Custom events

All events originate from interaction handlers, except save success, which runs
once in the successful response branch of that same save attempt. No events run
during rendering, hydration, automatic mode selection or history restoration.

| Event | Trigger location |
| --- | --- |
| Competition Banner Clicked | `app/dashboard/sponsored-carousel.tsx`: a navigable competition banner link. Locked/non-link banners and carousel arrows/dots do not dispatch it. |
| Squad Save Clicked | `app/dashboard/squad-editor.tsx`: enabled Save team handler, after the existing disabled guard. |
| Squad Save Succeeded | Same handler, only after `saveSquadDraft` returns without an error and the saved state is updated. Existing pending/disabled handling prevents repeated submissions; no success effects or retry handlers dispatch it. |
| Result Mode Clicked | Same file: manual Result mode button handler. |
| Squad Mode Clicked | Same file: manual Transfer mode button handler (the application's current label for squad editing). |
| Transfer Player Clicked | `app/dashboard/player-picker.tsx`: opens an allowed picker, for either Transfer player or an empty squad slot, after existing lock/club guards. |
| Full Statistics Clicked | `app/dashboard/player-statistics-button.tsx`: opens the full statistics dialog; `player-picker.tsx`: opens that dialog from outgoing-player identity/price or any available-player identity/statistic cell. |
| Player Points Clicked | `app/dashboard/squad-card-actions.tsx`: a Result mode player card; `league-squad-preview.tsx`: a player in an inspected squad. Both open the points breakdown. Ordinary squad action cards do not dispatch this event. |
| Private League Clicked | `app/(default)/dashboard/leagues/page.tsx`, through `app/analytics-link.tsx`: a private-league link in Your leagues. |
| Gameweek League Clicked | `app/dashboard/leagues/standings-view.tsx`: manual Gameweek control. |
| Season League Clicked | Same file: manual Season control. |
| League Team Clicked | `app/dashboard/league-table.tsx`: opens any standings team, including search results. Gameweek navigation, prefetch and retry do not dispatch it. |
| Sponsor Link Clicked | `app/competitions/artwork.tsx`: the external competition prize/product link, including Yasaka products. No destination is attached to the event. |

`Registration Completed` is intentionally not implemented. Signup currently sends
a confirmation email, with an existing-account resend branch; that is not a
completed registration. The shared code-exchange callback does not reliably
identify a newly completed signup separately from other auth flows. No auth
behavior or URL markers were added just for analytics. Yasaka logos themselves
are not links; they remain unchanged.

## Vercel configuration and verification

1. In Vercel, select the project serving `pingisliganfantasy.se`, open
   **Analytics / Web Analytics**, and click **Enable** if it is disabled.
2. Ensure Vercel supplies its system environment variables at build/runtime
   (including `VERCEL_ENV`). If the project's **Automatically expose System
   Environment Variables** setting is disabled, enable it. Keep `main` as the
   production branch and `develop`/staging as Preview or a staging environment.
   Do not manually set `VERCEL_ENV` or `NEXT_PUBLIC_ANALYTICS_ENABLED` to force
   analytics on. No new manual environment variables, tokens or DSNs are needed.
3. Release through the normal human-approved `develop` → `main` flow when ready.
   Enabling Web Analytics takes effect in the deployment's analytics endpoints
   after deployment; do not use a direct production deploy to verify this change.
4. On the production domain, open browser DevTools Network with Preserve log.
   Check that the analytics script loads once, visit pages through the app's
   navigation, and use the feature controls above. Inspect analytics request
   payloads: feature event names should match exactly, with no custom data;
   league/competition paths should be grouped and query strings absent. Save
   clicked should precede success, and failed/disabled saves must not emit success.
5. In Web Analytics, select Production and the corresponding time range/domain.
   Check Pages/Routes and Custom Events as traffic arrives. Open different players,
   teams and private leagues to confirm they share the same feature event names.
6. On localhost and a Preview/staging deployment, repeat navigation and clicks:
   there should be no analytics script and no analytics collection requests.
   A production deployment's `*.vercel.app` URL must also stay silent.

Browser verification on production remains a manual post-release step; local
checks cannot establish that Vercel has enabled ingestion for the hosted project.
Browser extensions/ad blockers can suppress collection.

References: [Vercel setup](https://vercel.com/docs/analytics/quickstart),
[custom events](https://vercel.com/docs/analytics/custom-events),
[URL redaction](https://vercel.com/docs/analytics/redacting-sensitive-data), and
[system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

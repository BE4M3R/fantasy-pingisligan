---
name: verify-ui
description: Inspect rendered Pingisligan Fantasy UI with the repository's Playwright setup. Use for mobile/desktop layout, responsive behavior, overflow, loading states and visual consistency; capture and open screenshots as evidence.
---

# Verify UI

Work from the repository root. Read [AGENTS.md](../../../AGENTS.md), the
[design system](../../../docs/design-system.md), and the
[rendered UI inspection procedure](../../../docs/automated-testing.md#rendered-ui-inspection).
The testing guide owns setup, isolation, capture examples and artifact paths.

1. Identify the affected routes, components and interactions from the request
   and diff. Define the mobile/desktop viewports and relevant ready, loading,
   empty, error and dialog states before running. Inspect neighboring components
   and `app/globals.css` for existing patterns and `--pf-*` token roles.
2. Inspect `playwright.config.ts` and relevant `tests/browser/*.spec.mjs`.
   Reuse the installed Playwright setup and local fixture helpers. Prefer
   `npm run test:all` for authenticated fixture-backed checks: snapshots process
   all teams, so these tests require a clean disposable database and one worker.
   For direct browser runs, verify both the app and tests target the same local
   Supabase stack, including shell overrides and any reused server. Never use
   hosted targets or reset a populated local database just to inspect UI.
3. Adapt the closest journey or create a temporary focused spec discovered by
   the existing config. Follow the testing guide's capture procedure; preserve
   fixture cleanup. Do not add dependencies or change production configuration.
   Read-only review requests do not authorize app fixes. Keep temporary
   instrumentation out of the final diff unless regression coverage is wanted.
4. Check narrow/typical phones and desktop, plus tablet and changed breakpoints
   where relevant. Check document overflow **and** clipped child content,
   scrolling, fixed navigation, short-height dialogs, text wrapping, touch
   targets, focus and reduced motion. Delay only the affected local request to
   inspect loading; release it to verify completion and check empty/error
   responses when relevant. Do not mock away business rules to obtain a state.
5. Save explicitly named screenshots for the affected routes/states at mobile
   and desktop sizes under ignored `test-results/browser/`. Capture both full
   pages and viewport/dialog views when useful. **Open and visually inspect
   every screenshot used as evidence with an image-viewing tool.** Compare
   spacing, type, cards, actions and colors with the design system. Assertions,
   DOM inspection and file creation alone are not visual verification.
6. When fixes are authorized, make focused corrections and rerun the affected
   states. Inspect the final diff and remove only your temporary instrumentation.

Report routes/states, viewport sizes, commands/results, links to screenshots
actually inspected, findings and remaining coverage. Distinguish layout checks
from mobile device emulation. If the browser, Docker, local credentials or image
viewer is unavailable, report the specific incomplete step; do not substitute
hosted access or claim a visual pass. Keep keys and real user data out of evidence.

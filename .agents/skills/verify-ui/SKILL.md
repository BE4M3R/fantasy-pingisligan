---
name: verify-ui
description: Inspect rendered Pingisligan Fantasy UI mobile-first with the repository's Playwright setup. Use for responsive layout, overflow, interactive states and visual consistency; capture and open screenshots as evidence.
---

# Verify UI

Work from the repository root. Read [AGENTS.md](../../../AGENTS.md), the
[design system](../../../docs/design-system.md), and the
[rendered UI inspection procedure](../../../docs/automated-testing.md#rendered-ui-inspection).
The testing guide owns test selection, setup, isolation, capture examples and
artifact paths; this skill adds rendered inspection.

1. Identify affected routes, components and important interactive states from
   the request and diff. Prioritize mobile usability and visual decisions. By default,
   **390 × 844 is the primary viewport; 1440 × 900 is secondary.** Identify the states
   relevant to the requested change. Do not exercise unrelated states unless there is
   a specific regression risk.
   Inspect neighboring components and styling for existing patterns.
2. Inspect `playwright.config.ts` and relevant `tests/browser/*.spec.mjs`.
   Reuse the installed Playwright setup and local fixture helpers. Follow the
   testing guide's local-target procedure for disposable runners, target safety
   and server reuse; do not start duplicate servers or databases. Never use
   hosted targets or reset a populated local database just to inspect UI.
   Reuse one fixture lifecycle and browser session for related states; avoid
   repeated setup and reruns when the existing evidence is sufficient.
3. Adapt the closest journey or create a temporary focused spec discovered by
   the existing config. Follow the testing guide's capture procedure; preserve
   fixture cleanup. Do not add dependencies or change production configuration.
   Read-only review requests do not authorize app fixes. Keep temporary
   instrumentation out of the final diff unless regression coverage is wanted.
   Seed data before navigation; account for server caches when changing states.
   Playwright's browser clock does not advance server-side cache expiry.
4. Exercise important interactions and responsive behavior using the design
   system's review criteria. Check browser console errors and uncaught page
   errors, document overflow **and** clipped child content. Check additional
   widths without screenshots unless they reveal an issue. Delay only the
   affected local request for loading inspection, then release it and verify
   completion; simulate empty/error responses when relevant. Do not mock away
   business rules to obtain a state.
5. Capture the primary mobile and secondary desktop views under ignored
   `test-results/browser/`, with route, state and viewport in their names.
   Add screenshots only for a distinct finding or important state (such as a
   live transition, narrow-screen defect or dialog); choose viewport, full-page
   or component captures to show the issue without redundant evidence.
   **Open and visually inspect every screenshot used as evidence with an
   image-viewing tool.** Compare
   spacing, type, cards, actions and colors with the design system. Assertions,
   DOM inspection and file creation alone are not visual verification.
6. When fixes are authorized, make focused corrections and rerun the affected
   states. Inspect the final diff and remove only your temporary instrumentation.

Report routes/states, viewport sizes, commands/results, links to screenshots
actually inspected, findings and remaining coverage. Distinguish layout checks
from mobile device emulation. If the browser, Docker, local credentials or image
viewer is unavailable, report the specific incomplete step; do not substitute
hosted access or claim a visual pass. Keep keys and real user data out of evidence.

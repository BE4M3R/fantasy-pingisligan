# Fantasy Pingisligan design system

This file records the approved visual palette for the public landing page and
the logged-in app. The CSS custom properties in `app/globals.css` are the
implementation source of truth. This document explains what each color means.

The logo artwork contains gradients, so its pixels are not a reliable color
reference. Use the solid companion colors below when building UI.

## Core brand palette

| Token | Value | Use |
| --- | --- | --- |
| `--pf-navy` | `#01213c` | Primary dark brand surface: cards, header and navigation |
| `--pf-navy-deep` | `#00172b` | Deepest surface, overlays and dark text on bright buttons |
| `--pf-navy-elevated` | `#062a4a` | Raised or nested content on navy cards |
| `--pf-brand-blue` | `#2587ef` | Primary interactive accent: links, selected states and main app actions |
| `--pf-brand-blue-hover` | `#51a2f5` | Hover/highlight partner for brand blue |
| `--pf-logo-gold` | `#ffc329` | Logo companion gold, landing-page primary CTA and headline accent |
| `--pf-logo-gold-hover` | `#ffd04a` | Hover state for gold actions |
| `--pf-fantasy-yellow` | `#febe1f` | Rank, captain and special fantasy highlights in the logged-in app |
| `--pf-rank-gold` | `#ffe45e` | Bright first-place leaderboard rank treatment |
| `--pf-rank-silver` | `#cbd5e1` | Second-place leaderboard rank treatment |
| `--pf-rank-bronze` | `#b8662f` | Third-place leaderboard rank treatment |
| `--pf-text` | `#f2f6f8` | Main text on dark backgrounds |
| `--pf-text-muted` | `#9fb8c6` | Secondary descriptions and metadata |

Gold is intentionally prominent on the public landing page. The closely
related fantasy yellow records the slightly warmer highlight already used in
the logged-in app. Silver and bronze complete the leaderboard medal hierarchy.
Use these rank colors sparingly: the app's normal interactive color is brand
blue, keeping medal colors available for rank and other special fantasy
moments.

## Public landing page

The public page uses a dark, atmospheric table-tennis surface so the white,
blue and gold logo remains the focus.

| Token | Value | Use |
| --- | --- | --- |
| `--pf-public-blue` | `#082f49` | Base public-page background |
| `--pf-public-blue-bright` | `#0c4a6e` | Bright end of the public background gradient |
| `--pf-public-blue-mid` | `#075985` | Middle of the public background gradient |
| `--pf-public-blue-deep` | `#083344` | Deep end of the public background gradient |
| `--pf-public-glow-rgb` | `14 165 233` | Decorative blue glow; stored as RGB for opacity support |

Use logo gold for the public primary CTA and key headline accent. Use
white or `--pf-text` for primary copy and `--pf-text-muted` for supporting copy.

## Logged-in app

The dashboard is brighter and more functional than the landing page. Its page
background resembles a blue table-tennis court, while content sits on navy
cards.

| Token | Value | Use |
| --- | --- | --- |
| `--pf-page-blue` | `#0a4d86` | Main logged-in page background |
| `--pf-page-blue-bright` | `#10619f` | Bright end of the dashboard gradient |
| `--pf-page-blue-deep` | `#084778` | Deep end of the dashboard gradient |
| `--pf-table-blue` | `#0b6fb5` | Explicit table/court surfaces |
| `--pf-table-blue-deep` | `#07558c` | Dark table/court variation |
| `--pf-card-border` | `#123a55` | Default border on navy cards |
| `--pf-brand-blue-soft` | `#0b3762` | Subtle blue selected or hover background |
| `--pf-brand-blue-border` | `#18558d` | Interactive or emphasized border |

## Semantic colors

| Token | Value | Use |
| --- | --- | --- |
| `--pf-coral` | `#ff6568` | Errors, destructive actions and states requiring attention |
| `--pf-coral-hover` | `#ff7c7f` | Hover state for coral actions |
| `--pf-coral-soft` | `#3a2130` | Subtle error/attention background |
| `--pf-coral-text` | `#ffcaca` | Readable text on a coral-soft background |

Framework colors such as Tailwind's emerald and amber may be used for familiar
success and warning messages. They are semantic feedback, not brand colors.

## Rules for contributors and AI

1. Reuse an existing `--pf-*` token whenever its meaning matches the UI role.
2. Do not add raw hex colors in components for normal brand UI.
3. Do not recolor or sample the PNG logo to derive new UI colors; use the core
   brand palette above.
4. Keep public primary actions yellow and logged-in primary actions blue unless
   a deliberate design change updates this guide.
5. Coral means an error, destructive action, or attention-needed state. Do not
   use it as decoration.
6. When adding a genuinely new palette color, name it by role, define it in
   `app/globals.css`, and document its value and purpose here.

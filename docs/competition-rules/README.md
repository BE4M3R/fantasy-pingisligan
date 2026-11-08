# Shared competition rules: publication review

The two Markdown files in this directory are the agreed product rules, prepared
as **unapproved drafts**. They are not evidence of legal approval. Copy only their
Markdown body into `competition_rules.body`; do not copy this review document.

| Ruleset | Body file | Local draft created |
| --- | --- | --- |
| Weekly Smash (`kind = gameweek`) | [weekly-smash.md](weekly-smash.md) | Version 6 |
| Season Competition (`kind = season`) | [season-competition.md](season-competition.md) | Version 3 |

The local version numbers follow existing draft history and can differ between
kinds. Both new review rows have `approved_at = null`. Earlier local versions 5
(gameweek) and 2 (season) were approved manually during the demo; their contents
and historical banner bindings remain intact. Their text matches the authoring
files, so local preview uses those existing approved editions. Review drafts 6/3
are associated with their competition kinds; they cannot be assigned to public
pages until approved. Do not repoint completed competitions or weaken the
approved-version guard to display drafts. No prize, score or hosted data changed.
A draft cannot be referenced as an approved banner rule version or read by normal
public/authenticated visitors.

## Editing and historical versions

Edit the applicable Markdown authoring file in Git first and review the diff. Then,
in local Supabase Studio, copy that exact body into the relevant unapproved
`competition_rules` draft and set its `title`. Keep `approved_at` empty until
publication review is complete. For later environments, create the same reviewed
body as a new draft there; local row IDs and version numbers are not portable.
Use the same five `##` headings as the files. Inline Markdown links and lists are
supported. There is one shared document for each kind/version, not one per prize.

Published documents are immutable. Subsequent edits require a new version for the
same kind. Previously bound competitions keep their original `rules_version_id`.
Approval can automatically bind unbound, ready future Gameweeks and the unbound
published season page, using the existing triggers. It does not automatically
rewrite completed competitions or any existing binding. Do not attach these drafts
retroactively to past Gameweeks merely to preview the text.

`homepage_banners` keeps its prize, sponsor, images, value, external product link
and optional `details_markdown` conditions. Do not paste these shared rules into
individual banners. Optional conditions appear inside the Prize delivery accordion,
without a separate prize-specific heading. Leave them empty when unnecessary.

## Mobile presentation

The overall Rules and practical information section stays visible. Approved
structured documents appear as five native, independently expandable sections:
Participation; Winner Selection; Winner Announcement & Claiming;
Prize Delivery; Taxation. They start closed and can remain open together.
`details`/`summary` provide native keyboard and expanded-state accessibility, with
visible focus styling. There is no outer accordion to open first and no added
client-side state or dependency.

Unstructured older approved text is preserved under Participation. Unknown headings
and introductory text are retained rather than discarded. Empty categories do not
invent new conditions. Unapproved documents stay private and do not appear in ordinary page responses.
A separate [feature launch switch](../competition-launch.md) also defaults to off;
rule approval alone can never publish competitions.

## Review before publication or prize awards

- **Classification and random tie-break:** review the specific promotion's legal
  classification and any applicable gambling/lottery requirements. Skatteverket
  says the final deciding element matters when performance and chance are combined;
  this does not establish how these Fantasy competitions must be classified.
- **Taxation and reporting:** Skatteverket lists SEK 1,800 for qualifying competition
  prizes in 2026. Confirm the actual award year's threshold, all exemption conditions,
  the full taxable value where applicable, and organizer/provider reporting duties.
  Price alone does not establish an exemption.
- **Gift card:** confirm Wood House AB's redemption terms, especially whether the
  card can be converted into cash. Do not publish an unconditional tax-free claim.
- **Minors and privacy:** settle age/territory eligibility, the lawful basis for
  processing, age-appropriate privacy information, guardian verification, retention
  and how Wood House AB receives fulfilment data. IMY's guardian-consent rule for
  Swedish children under 13 applies when an online service relies on consent;
  winner-stage guardian confirmation alone does not resolve registration privacy.
- **Operational terms:** confirm delivery territories/restrictions, identity checks,
  staff/test/multiple-account eligibility, how calendar-day deadlines are measured,
  cancelled/postponed fixtures, corrections/objections and season boundaries. The
  agreed email-triggered claiming periods are five days weekly and ten days season;
  each replacement winner receives a fresh full period.

Sources checked on 1 November 2026:
[Skatteverket: winnings from games and competitions](https://www.skatteverket.se/privat/skatter/arbeteochinkomst/inkomster/vinsterispelochtavlingar.4.7459477810df5bccdd4800015166.html),
[IMY: personal data about children](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/introduktion-till-gdpr/personuppgifter/personuppgifter-om-barn/).

The later confirmation phase must implement exactly these selection and claiming
rules: weekly net points → raw effective-captain points → documented draw; season
total points → sum of raw effective-captain points → documented draw. This task
adds no season calculation, draw execution, confirmation, automatic announcements,
runner-up reassignment, email sending or administrative interface.

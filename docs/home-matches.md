# Home matches and stream links

Home shows fixtures for the current gameweek, or the next gameweek before play
starts. A gameweek waiting for results/scoring completion stays selected while
transfers are closed. After the season ends it keeps the latest gameweek's results. Each
fixture tracks its own Upcoming, Live, Final, Postponed or Cancelled status.
The match rows sit in a separate card immediately above Squad Status, below
the summary stats. The card title is `Upcoming matches`.
Fixtures share a small Stockholm date heading (for example, `Wed 7 Oct`),
with a separate group for each playing date and for unconfirmed dates. Rows
show only the start time, or a yellow dot and `LIVE` during play, and keep both
club logos close to the centered score. The locked-squad reopening message uses
the existing unlock time: `Squad unlocks from 4 Oct · 00:00`.
The stream icon appears without a surrounding square border or background,
inside a 36px mobile or 40px larger-screen touch target.
Club names remain available to screen readers and on hover. Final status labels
and the routine footer are omitted; exceptional statuses remain beside the
score, while live status appears once in the time column.
A scheduled fixture goes Live once its start time arrives and stays Live across
midnight until it finishes. Imported live statuses or partial scores also mark
a fixture Live. Each club and score group sits on a compact blue background; the yellow dot beside
LIVE pulses once a second with a smaller, softer halo than the GW indicator.
Reduced-motion preferences disable both animations.
The top-right GW badge follows the transfer lock: GW Open while transfers are
available, then yellow GW Live with a pulsing indicator as soon as squads lock.
It stays GW Live after the fixtures finish and while results/scoring completion
is pending, until transfers actually reopen. There is no intermediate GW Locked
badge. Either club reaching five wins marks the fixture Final and removes its
live dot, even before the imported status changes. Cancelled and postponed
fixtures keep their exceptional status. Locking transfers does not mark fixtures live.

Scores count completed singles and deciding golden doubles from the existing
server-side import. Each child match contributes one club win, including doubles
with two players. Final scores stay visible. A final without imported scores
shows a dash instead of an invented 0–0 result.

The existing production results job updates statuses even before the first
singles finishes. Nightly and full manual results workflows import the latest
schedule before importing results; match-window polls and a standalone
`npm run import:results` update results without refetching the schedule. Home
refreshes only its match card every minute while visible, with
database reads shared through the existing 60-second public-data cache. While
every fixture is still far from kickoff, it checks time each minute and fetches
the latest schedule every five minutes, including when an older open tab becomes
visible again. Visibility changes cannot trigger another request within a minute
of the previous attempt. Failed refreshes retain the previous scores and retry.

The local functional test reimports a changed schedule and verifies gameweek
isolation, kickoff times and club names in the public match summary. Browser
tests check those details on Home, the in-place schedule refresh, the exact
kickoff transition to LIVE, and removal of LIVE when a club reaches five wins.

## Update a stream

Edit `data/match-streams.json`. Use the club's stable key from `lib/clubs.ts`
and its public HTTPS streaming channel URL:

```json
{
  "rekord": "https://www.youtube.com/@BTKRekord1/streams"
}
```

The seven clubs' channels are stored here. Each fixture uses its home club's
channel, with club aliases resolved through the shared club catalogue; local
synthetic fixtures follow the same rule. Remove an entry when its link should
no longer be available. Links without an HTTPS URL are ignored. Fixtures
without a link say No stream; valid links enable a stream icon button that
opens a new tab. Cancelled fixtures do not show a stream button.
Commit updates to a feature branch,
promote through `develop`, then `main` to publish them. Links are public and must
not contain credentials or private tokens.

Deploy migration `20261002120000_home_gameweek_matches.sql` through the usual
staging then production workflow. It adds indexed, compact public score reads
through `get_gameweek_matches`; raw STUPA result payloads remain private. No new
Vercel environment variables are needed.

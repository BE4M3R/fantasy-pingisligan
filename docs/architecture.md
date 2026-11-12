# Architecture

Fantasy Pingisligan is a Next.js App Router application backed by Supabase Auth
and Postgres. Vercel can host the web application; data imports run separately
as trusted server-side jobs.

```mermaid
flowchart LR
    User[Browser] --> Next[Next.js on Vercel]
    Next --> Auth[Supabase Auth]
    Next --> DB[(Supabase Postgres)]
    Catalogue[Committed player catalogue] --> Importers[Server-only import scripts]
    Stupa[Stupa schedule and results] --> Importers
    Importers -->|service role| DB
```

## Web application

- Server Components render routes and read data with the server Supabase client.
- Authentication checks use verified JWT claims through `auth.getClaims()`.
- Middleware refreshes the Supabase session cookies when necessary.
- The dashboard initially loads only the current fantasy team and its squad.
- Opening a player picker triggers `GET /api/players`; the player pool is not
  included in the initial dashboard render.
- The catalogue RPC `get_transfer_players` returns one compact statistics summary
  per active player. `GET /api/players/[playerId]` loads player history and the next
  three scheduled club fixtures only when a statistics dialog or squad actions
  popup opens. The squad popup reuses the statistics summary (price, form and
  ownership), recent form and upcoming opponents in a labelled Player overview
  section below its three-action Team action row. All overview cards use the
  same navy surface; compact spacing on short screens keeps actions reachable.
  A smaller remove action sits at the bottom left and the larger Full player
  statistics action sits at the bottom right. Both views share one bounded 60-second browser cache
  and in-flight request; the dashboard does not preload player histories. Both routes
  require verified authentication. Statistics appear in a dialog that preserves
  the transfer draft and filters. The outgoing card's identity and price, and
  player and statistic cells in the transfer list, open this read-only dialog;
  adding a player uses only
  the transfer window's add button. Result popups show the gameweek breakdown
  without a full-statistics action. Compact cards keep price, points, form and
  ownership percentage on one row on phones; info buttons open dismissible
  explanations. The next
  three opponents share one row with logos, names and gameweek/home/away labels.
  Recent form shows the last five finished gameweeks: missed weeks show `-`,
  while played weeks show their points, including zero. The Form
  summary still averages the last five finished gameweeks, including missed
  weeks as zero. Singles sets and their points are split by won/lost matches.
  Player statistics and transfer summaries include only gameweeks whose unlock time has passed and
  whose results/scoring refresh has completed, using the same completion marker
  as the local and production unlock flow. Inactive owned players retain their
  history but cannot be newly transferred in.
- Ownership percentages reuse the latest completed gameweek's locked squad
  snapshots, including starters and bench players. Teams without a snapshot
  are excluded. The shared catalogue RPC supplies the same percentage for the
  transfer table and player dialog; no per-player ownership requests are needed.
  Only aggregate percentages are public, never individual manager selections.
- The transfer picker sorts locally through clickable statistic column headers,
  toggling ascending/descending order with an arrow beside the active title.
  The Player header sorts by surname; names use a first initial and surname.
  Numbers in the active statistic column are white and other columns are muted.
  Price, form and ownership use equally sized columns on phones; wider screens
  also show points and singles win rate. Club logos sit beside player names,
  and transfer buttons show `+` or the reason a player cannot be added.
  When replacing a player, a compact card shows their club logo, name, club and
  price above the available-player count and sortable table. Only selected rows
  are highlighted; regular rows share a surface with subtle separators. The
  modal header, search and filters stay fixed while the outgoing card and table
  scroll together. The card reuses the catalogue or the owned player's existing
  data; opening statistics still loads details on demand.
- Squad changes use Server Actions. Every mutation rechecks authentication,
  transfer locks, ownership, squad rules and budget on the server.
- Supabase Row Level Security remains the database-level authorization boundary.
- Home shows the signed-in manager's profile display name under their team name.
  Global and private standings, search results and team dialogs show the same
  smaller secondary text. Standings RPCs join profiles in the existing query;
  missing or blank names omit the secondary line. Display names follow the
  existing public global-standings visibility; emails are never added to rows.
- Team owners can update only `name`, `onboarding_completed`, and `updated_at`.
  New teams must start with a 100m budget; only trusted server operations can
  adjust existing budgets. The complete-squad save RPC requires exactly one
  captain among the four starters before invoking the atomic save.
- Player merges, squad snapshots, chip maintenance, and scoring RPCs require
  `service_role` or a privileged database operator. API users cannot invoke
  these administrative paths to bypass squad validation or rewrite history.

## Data pipeline

The data sources have a required dependency order:

```mermaid
flowchart LR
    Catalogue[Permanent UUIDs and explicit prices] --> Players[players and clubs]
    Schedule[Stupa scheduled team fixtures] --> Gameweeks[fantasy_gameweeks: rounds and transfer windows]
    Schedule --> Matches[matches: one row per scheduled team fixture]
    Completed[Stupa completed match details] --> Submatches[stupa_submatches: individual matches within a team fixture]
    Matches --> Submatches
    Players --> PlayerResults[player_submatch_results: each player's sets and points]
    Submatches --> PlayerResults
    Completed --> PlayerResults
    PlayerResults --> Stats[player_match_stats]
    Gameweeks --> SnapshotCron[Supabase Cron: locked squad snapshots]
    SnapshotCron --> Snapshots[gameweek squad snapshots]
    Snapshots --> Stats
```

`fantasy_gameweeks` does not contain every fixture itself. It represents a
round and stores the first and last match times plus the transfer lock window.
The individual team fixtures are rows in `matches`, linked back to their
gameweek through `fantasy_gameweek_id`.

While a gameweek transfer window is closed, Supabase Cron calls the idempotent
`snapshot_locked_squads()` database function every five minutes. It creates one
snapshot header for every complete six-player team that existed at the deadline
and immutable player rows containing names, position, captain, price and club
data. An incomplete team is skipped and can enter for the first time in a later
gameweek. Repeated calls are safe because the snapshot tables use
team/gameweek/player keys and ignore conflicts. Later scoring must use these
rows rather than the live squad.
After the scheduled unlock time, transfers remain closed until the scheduled results job
has imported available STUPA results and scored them successfully. The results
importer then scores the oldest pending unlocked gameweek and atomically records
`fantasy_gameweeks.data_refreshed_at` with the locked chips as used, clearing
its refresh lock. Prices and budgets remain unchanged; the scheduled results
job never imports or reprices players.

Results are checked daily at 00:07 Stockholm time and additionally every 15
minutes at :07, :22, :37, and :52 from the first fixture start on each playing
day until five hours after that day's last fixture start, including across
midnight. Individual fixture dates drive this decision, including
when a gameweek spans several days. GitHub schedules only the nightly run, which
refreshes fixtures first. Supabase Cron checks the shared database window rule
every 15 minutes and dispatches GitHub only when due. A dispatched run checks
the same rule before importing. GitHub Actions runs may be delayed.

The Stupa schedule and completed results are two views of the same real-world
team fixtures. The schedule importer creates the parent `matches` rows before
play. After play, the results importer attaches the individual submatches and
per-player set/point details to those existing fixtures. The current results
importer stores source results and recalculates `player_match_stats` and
fantasy-team gameweek totals. Player eligibility depends on active status and
an explicit configured price; optional legacy rankings do not affect it.

Result persistence uses the service-role-only `persist_stupa_results` RPC, also
used by the synthetic lifecycle harness. It locks affected fixtures and
atomically replaces superseded STUPA IDs by fixture, singles/golden kind and
match order, together with their player results. Unobserved positions remain
intact; ambiguous incoming positions abort the transaction. Scoring and refresh
completion run only after successful persistence.

## Trust boundaries

Competition routes, discovery and public competition APIs share the default-off
`competition_publication` database flag. Restrictive policies additionally protect
direct banner/rules reads and artwork; the public competition standings RPC checks
the same switch. A separate default-off `season` row in `competition_publication`
controls all season prize discovery, detail, terms and artwork while keeping
weekly publication available; both flags are required for season prize access.
The `global` row is the master switch; season and gameweek rows are independent
opt-ins. Schedule imports create named disabled rows and preserve prior choices.
Ordinary Fantasy season standings remain available. Signed-in Fantasy Gameweek
standings and lifecycle metadata are independent of publication; competition links in Leagues still require launch. Missing/failed configuration disables the feature. Disabled
routes return 404/noindex, and competitions are absent from sitemaps. See
[launch controls](competition-launch.md).

Home's streamed sponsored carousel uses the authenticated, security-invoker
`get_homepage_competitions()` RPC. A shared SQL calculation follows the existing
transfer lock and `data_refreshed_at`; RLS protects weekly content readiness and
independent season publication, including direct table and Storage access.
All opted-in historical, current and future rounds, plus an opted-in final season
card are returned without creating content rows. One batch signs readable artwork.
Each gameweek has a linked `competition_publication` row with `enabled`
default false, which controls prize-round selection without affecting Fantasy scoring or signed-in standings. Hidden rounds
have no public page, promotion or prize/artwork disclosure.
Each Gameweek banner row also holds optional public `teaser` copy for its locked
card. A narrow security-definer projection returns only Gameweek IDs and teaser
text for enabled competitions, independently of the banner's prize RLS gates.
The existing metadata request joins that projection while keeping prize reads
security-invoker; schedule imports preserve operator edits.
Home entry selects the most recently completed Gameweek's winner during the 48
hours after its `unlock_at`, then current (or latest completed), without
interrupting browsing. One additional fresh batch RPC reads public winner
decisions, alongside a one-row lookup of the latest completed Gameweek's unlock
time. The initial slide is chosen on the server; the web application uses no privileged client.
See [homepage highlights](homepage-banners.md).

Public `/competitions/gameweek/[number]` and `/competitions/season` pages use
an anonymous client with fresh reads. Their content/Storage reads share the
carousel reveal rules; social metadata never reads draft content. Weekly pages load five public standings rows server-side, with bounded incremental
loading through the same existing RPC. Leagues adds Season/Gameweek controls and
left/right round navigation, defaulting to the latest started round. Both modes
reuse the existing interactive `LeagueTable`; the authenticated weekly projection
uses the same scoring entry helper as public competitions. Public competition
search continues to return only names, ranks and points. Private league
authorization stays unchanged.
Season/Gameweek switching and round arrows update only the client standings
panel through authenticated `GET /api/league-standings`, using the same server
loader as initial rendering. Both views initially show the top five and the
manager's position below when outside that group. Gameweek competition links
appear only for ongoing or the most recently completed round, subject to
competition publication. Native history updates retain shareable URLs and
Back/Forward behavior without rerendering the page. The panel reserves its height
and keeps the previous table visible during loading/failure, preserving scroll.
A per-panel 30-second cache holds at most 16 compact views; competing requests
are aborted and stale responses ignored. API responses remain private/no-store.
Competition pages use the brand wordmark and show a dedicated winner box above
the prize when a winner is selected, with a pending notice for completed rounds.
Their prize headers have no lifecycle badge, and competition leaderboard headings
and Leagues Gameweek navigation omit provisional labels. Prize product
links are optional HTTPS URLs separate from generated internal destinations. Locked
squads remain private. Operator-only provisional review derives
the same competition rank as the public board: net Gameweek points, raw
effective-captain points, and cumulative season points through the selected
Gameweek's deadline. Later rounds are excluded; fully tied teams share a rank
for a manual draw. Ordinary Fantasy league ranks still use points alone.
Operators select `competition_publication.competition_winner` in Supabase Table
Editor. This nullable foreign key references a Fantasy team; setting, replacing or
clearing it directly controls the announcement. A read-only public projection
returns the selected team's current name and optional stored Gameweek points,
plus the public Gameweek UUID. Global/round switches and future embargoes still
apply. No winner-selection algorithm, draw or score-invalidation triggers remain.
Email, social delivery and the existing announcement inbox stay separate.
See [competition pages and provisional results](competitions.md).

Legacy UUID links redirect to an unambiguous number; repeated numbers retain UUID
links rather than guessing a season. No season mapping is introduced. Approved
`competition_rules` document versions are immutable and bound once to each prize
row. The shared Rules page instead uses `get_current_competition_rules()` to fetch
only the latest approved policy per enabled kind, even when it has no prize
binding. This narrowly scoped public projection preserves launch/season switches
and never returns drafts or prize metadata. Direct table reads retain their
revealed-prize RLS. Public landing pages stream
two compact promotions through the same reveal-protected detail projection. The
dashboard carousel and announcement delivery remain independent.

Dashboard announcements use a persistent layout controller and the existing
Supabase clients/Server Actions. A compact per-user summary supplies popup
candidates and unread count; inbox history and content load on demand. Database
publication policies also guard private artwork. Individual dismissals persist
per user across devices without snoozing, polling or publication jobs. See
[announcements](announcements.md) for publishing and reader behavior.

Public Supabase URL and anonymous keys may be used by the web app. The service
role key bypasses RLS and is restricted to local/server import jobs. Scraping,
source parsing and service-role writes belong in `scripts/`, a scheduled GitHub
Action, or another trusted server environment—not a Client Component.

# Database model

`supabase/schema.sql` is the complete schema for a new Supabase project. The
separate migration files update projects that already have the schema installed.

```mermaid
erDiagram
    PROFILES ||--o| FANTASY_TEAMS : owns
    FANTASY_TEAMS ||--o{ FANTASY_TEAM_PLAYERS : contains
    FANTASY_TEAMS ||--o{ LEAGUE_MEMBERS : joins
    LEAGUES ||--o{ LEAGUE_MEMBERS : contains
    PLAYERS ||--o{ FANTASY_TEAM_PLAYERS : selected
    CLUBS ||--o{ PLAYERS : represents
    FANTASY_GAMEWEEKS ||--o{ MATCHES : groups
    MATCHES ||--o{ STUPA_SUBMATCHES : contains
    STUPA_SUBMATCHES ||--o{ PLAYER_SUBMATCH_RESULTS : records
    PLAYERS o|--o{ PLAYER_SUBMATCH_RESULTS : resolves_to
    MATCHES ||--o{ PLAYER_MATCH_STATS : summarizes
    PLAYERS ||--o{ PLAYER_MATCH_STATS : earns
```

## Main areas

- `profiles` mirrors application-specific user information from Supabase Auth.
- `fantasy_teams` is one user's team, name and budget.
- `fantasy_team_players` is the six-player squad, including position and captain.
- `leagues` and `league_members` provide invite-only private leaderboards. The
  creator is added as the first member and can share the league's invite code.
- `fantasy_team_chip_selections` stores each team's pre-deadline chip pick for a
  gameweek, then records when that chip locks and when it is used.
- `players` and `clubs` contain imported ranking data. `profixio_id` is also used
  to match Stupa's `license_id`; `stupa_user_role_id` stores the Stupa identity.
- `fantasy_gameweeks` is created from Stupa rounds. Its first and last match
  timestamps produce the transfer lock window.
- `matches` contains the parent team fixtures required before results can load.
- `stupa_submatches` retains each source submatch and its raw payload.
- `player_submatch_results` retains per-player set and point details. Its
  `player_id` may be null when an imported identity cannot be matched.
- `player_match_stats` stores calculated singles, doubles, set, fixture-bonus,
  walkover and gameweek-bonus points derived from the raw Stupa rows.

## Authorization and business rules

RLS is enabled on application tables. Public sports data has read policies;
team data is limited to its owner. Server Actions still validate business rules
such as the four-starter/two-bench limit, one captain, budget and transfer lock.
The two-players-per-club rule is also enforced by a database trigger so writes
outside the application cannot bypass it.

The database functions `current_transfer_lock()`, `get_my_gameweek_progress()`,
`get_my_played_gameweek_progress()`,
`snapshot_locked_squads()`,
`calculate_player_match_stats()`, `calculate_fantasy_gameweek_points()` and
leaderboard-related RPCs provide
derived data to the application. Private league creation, invitation joining,
listing and rankings go through security-definer RPCs that verify the signed-in
user and league membership.

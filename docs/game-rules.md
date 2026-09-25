# Fantasy Pingisligan game rules

> Draft for discussion.

## Definitions

- A **gameweek** is one imported Stupa league round.
- A **team fixture** is one club-versus-club fixture in that round.
- An **individual match** is one player-versus-player match within a fixture.
- A **set** is one set within an individual match.

Using these terms consistently avoids ambiguity when results are converted into
fantasy points.

## Squad

- Budget: **SEK 100 million**.
- Squad size: **6 players**.
- Club limit: **maximum 2 players from the same club**, counting main and bench players together.
- Starting lineup: **4 players**.
- Bench: **2 players**.
- There are no player positions or formation requirements.

A squad can be saved only when all six slots are filled: exactly four starters
and two bench players. Until then, the selection is only an unsaved draft in
the browser.

If a club correction puts an existing saved squad over the club limit, its
selection remains intact. Transfer mode shows a warning above “Select your
squad”. Until the draft is within the limit, only players belonging to an
over-limit club can be transferred out or removed; captain and lineup swaps
are disabled. Incoming players must still satisfy the club limit. Normal
editing resumes once the draft is corrected, and the complete squad must meet
the two-player limit before it can be saved. These transfers follow the normal
free-transfer and points-cost rules.

Only starters score points by default. The two bench slots have a clear first
and second priority.

After all fixtures in the gameweek have been resolved, a starter who recorded
no singles or doubles appearance during the entire gameweek is automatically
replaced by the highest-priority bench player who did record an appearance. A
second eligible bench player can replace a second absent starter. An awarded
walkover counts as an appearance because it produces a scoring result.

Bench points are shown but do not otherwise count toward the gameweek total
unless the Bench Boost chip is active. A bench player's points can count only
once; an automatic substitution and Bench Boost cannot count the same points
twice.

## Gameweek deadline

The gameweek deadline is two hours before the scheduled start of the earliest
team fixture in the gameweek. The starting lineup, captain, transfers, and
active chip lock at that deadline. They can be changed again when the transfer
window reopens at 00:00 Swedish time on the day after the final scheduled team
fixture.

Only a complete saved squad receives a gameweek snapshot and scores points. If
a user has not saved all six players before a deadline, they do not enter that
gameweek. When they save a complete squad after transfers reopen, their first
entry is the following gameweek and is treated as their initial squad rather
than as six charged transfers.

Automatic substitutions can use only players selected on that team's bench at
the deadline. The locked snapshot keeps the submitted positions and captain for
audit history; scoring derives substitutions and effective captaincy without
rewriting that snapshot.

## Player scoring

Points are calculated from completed individual matches and then added together
for the gameweek.

| Event | Points |
| --- | ---: |
| Win an individual match | +4 |
| Set difference in a won individual match | +1 per set |
| Win a set in a lost individual match | +1 |
| Win a doubles match, per player | +2 |
| Appear in a team fixture that the player's club wins | +3 |
| Seal a team-fixture win | +2 singles / +1 each in doubles |
| Win every singles match in the gameweek, with at least two played | +2 |

The set-points award differs by result. In a won individual match, it is the
set difference: a 3-2 win gives 1 point, a 3-1 win gives 2, and a 3-0 win
gives 3. In a lost individual match, a player still receives 1 point for each
set won. Lost sets do not deduct points.

The club-win bonus is awarded only to players with an imported singles or
doubles appearance in that fixture for the winning club. Other players
registered to the club receive no bonus. It is awarded separately for every
winning team fixture in which the player appears, so a player receives two
club-win bonuses only if they participate in two fixtures that their club wins
in the same gameweek. The player's club is frozen at the gameweek deadline, so
a later transfer or roster import cannot change this bonus during recalculation.

The player or pair that wins the final scored individual match for the club
recorded as the team-fixture winner receives a clinching bonus. A singles
clincher earns 2 points; if the clincher is doubles, each player earns 1 point.
When a deciding golden doubles follows the regular matches, it is the final
match even though STUPA numbers it from one again. An earlier singles winner
does not also receive a clincher bonus. If the final scored match was won by
the other club, no clincher bonus is awarded.

These rules also apply to Gameweek 1 and any other previously scored round.
Migration `20260925122000_rescore_scored_gameweeks.sql` recalculates stored
player and team points from imported results and the squads locked at each
deadline. It leaves those squads, player prices, team budgets and transfer
history unchanged.

### Walkovers

A player awarded a singles walkover receives points for an individual match win
and a three-set difference:

- Individual match win: 4
- Three-set difference: 3
- **Total before fixture or gameweek bonuses: 7 points**

If a player retires after an individual match has started, the match is treated
as a walkover awarded to the opponent. The opponent receives the standard
walkover points, and no points are awarded for sets completed before the
retirement.

### Doubles

Each player on the winning doubles pair receives 2 points for the match win. Doubles do not receive set points; a losing doubles pair receives no points.

Fixture-wide and gameweek-wide bonuses are calculated per player and are not
divided.

Players who are not in the fantasy player pool never receive fantasy points.
Their results can still be used to calculate the points of an eligible opponent.

### Scoring example

A player wins 3-1 and the player's club wins the fixture:

- Individual match win: 4
- Set difference: 2
- Club win: 3
- **Total: 9 points**

## Captain

- The captain must be in the starting lineup.
- The captain scores **2x** points for the gameweek.
- The captain can be changed between gameweeks before the deadline.
- The multiplier applies to every point the captain earns, including all player,
  fixture, and gameweek bonuses.
- If the captain records no appearance and is automatically substituted, the
  incoming bench player becomes captain and receives the multiplier. When more
  than one starter is replaced, captaincy follows the bench player paired with
  the absent captain by the normal substitution priority.

## Live results and leaderboards

A gameweek appears in league history when its first team fixture starts. Its
score updates as completed results are imported and scored. The home-page
gameweek card shows **GW Open** while transfers are available, **GW Locked**
between the deadline and first fixture, then **GW Live** with a pulsing
indicator while the gameweek is in progress. Future gameweeks do not contribute
to league totals or rankings.

## Transfers

- Initial squad selection before the first deadline is unlimited and free.
- Each team receives **1 free transfer per gameweek**.
- The first free transfer becomes available after gameweek one; initial squad
  selection does not create a carried transfer.
- Unused free transfers roll over, up to a maximum of **4 available free
  transfers**.
- Each additional transfer costs **4 points** in that gameweek.
- Transfer usage is the net number of players changed from the previous locked
  squad. A change that is fully reversed before the deadline therefore does not
  use a transfer.
- The squad builder prevents adding a player when that change would exceed the
  budget, squad, starting-lineup or bench limit, or maximum of two players per
  club. A full
  squad can still replace one player with another through a valid transfer.

### Player prices and team value

- Current player prices are fixed at their stored values. The application and
  imports do not calculate prices from rankings, and gameweek refreshes do not
  change them. An offline command can reproduce the former formula for a
  manually reviewed new-player price.
- An active player with a configured price can be selected even without ranking
  data, subject to the normal budget and club limits.
- Transfers reopen after STUPA results import and scoring complete successfully
  for the pending unlocked gameweek. A failed job leaves transfers closed until
  it is retried. Prices, team budgets and existing squads remain unchanged.
- Transfers buy and sell players at their current displayed price.
- A future explicit price update can use the existing budget adjustment during
  the pending unlocked gameweek, before completion. Completed teams then keep
  the same unspent cash: their total value changes by the price delta for players
  in that gameweek's locked squad. No automatic price update is scheduled.

## Chips

Each chip can be used once per season, with at most one chip active in a
gameweek.

### Wildcard

Make unlimited transfers in one gameweek without point deductions.

### Triple Captain

The captain scores **3x** instead of 2x for one gameweek.

### Bench Boost

Both bench players' points count toward the gameweek total.

## Postponed and rescheduled fixtures

The schedule importer should refresh match dates and times at least once per
day. Before a gameweek locks, every confirmed schedule change updates its
deadline to two hours before the new scheduled start of its earliest team
fixture. If that updated deadline has already passed when the change is
imported, the gameweek locks immediately.

Once a deadline has passed, its lock and unlock boundaries are frozen and the
gameweek is not reopened. The schedule importer still updates individual
fixture times and statuses. A postponed fixture remains attached to its
original gameweek and is scored against that gameweek's locked squads when it
is eventually played. Transfers for later gameweeks do not change the earlier
snapshot.

## Possible later additions

These ideas need more precise definitions or additional data and are excluded
from the first scoring version:

- **MVP bonus:** requires an objective performance-rating formula and tie rule.
- **Scout bonus:** could award +3 when a scoring player has less than 5%
  ownership at the deadline, but ownership must be snapshotted first.
- **Home/away record and last-five form:** useful player statistics, but not a
  pricing or scoring input until a formula is agreed.

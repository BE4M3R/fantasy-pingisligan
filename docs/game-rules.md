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
- Club limit: **maximum 2 players from the same club**.
- Starting lineup: **4 players**.
- Bench: **2 players**.
- There are no player positions or formation requirements.

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

If a squad is incomplete at the deadline, its selected starters still score.
Every empty slot contributes no points. Automatic substitutions can use only
players already selected on that team's bench at the deadline.

If no captain has been selected, the system assigns one of the selected
starters at random when the transfer window closes. The assignment is stored in
the locked gameweek snapshot so recalculating the gameweek cannot select a
different captain. No captain is assigned if the team has no starters.

## Player scoring

Points are calculated from completed individual matches and then added together
for the gameweek.

| Event | Points |
| --- | ---: |
| Win an individual match | +4 |
| Win a set | +1 |
| Win a doubles match, per player | +2 |
| Player's club wins the team fixture | +3 |
| Win every singles match in the gameweek, with at least two played | +2 |

A player can still earn points for sets won in a lost individual match. Lost
sets do not deduct points.

The club-win bonus is awarded to every fantasy player registered to the winning
club, whether or not the player appeared in that fixture. It is awarded
separately for every team fixture the club wins, so a player receives two
club-win bonuses if their club wins two fixtures in the same gameweek.

### Walkovers

A player awarded a walkover receives points for an individual match win and
three sets won:

- Individual match win: 4
- Three sets won: 3
- **Total before fixture or gameweek bonuses: 7 points**

If a player retires after an individual match has started, the match is treated
as a walkover awarded to the opponent. The opponent receives the standard
walkover points, and no points are awarded for sets completed before the
retirement.

### Doubles

Each player on the winning doubles pair receives 2 points for the match win.
Points for sets won are added together for the pair and then divided equally
between the two players. If the result is a half-point, each player's score is
rounded up to the next whole point. For example, the set points from a 3-1
doubles win are 3 before division. Each player therefore receives 2 set points
in addition to the 2-point match-win award, for a total of 4 points. Rounding
happens once on the doubles match's set total, not separately for each set.

Fixture-wide and gameweek-wide bonuses are calculated per player and are not
divided.

Players who are not in the fantasy player pool never receive fantasy points.
Their results can still be used to calculate the points of an eligible opponent.

### Scoring example

A player wins 3-1 and the player's club wins the fixture:

- Individual match win: 4
- Three sets won: 3
- Club win: 3
- **Total: 10 points**

## Captain

- The captain must be in the starting lineup.
- The captain scores **2x** points for the gameweek.
- The captain can be changed between gameweeks before the deadline.
- The multiplier applies to every point the captain earns, including all player,
  fixture, and gameweek bonuses.
- If the captain records no appearance, the multiplier is not transferred to an
  automatically substituted bench player.

## Transfers

- Initial squad selection before the first deadline is unlimited and free.
- Each team receives **1 free transfer per gameweek**.
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

Once a deadline has passed, it is frozen and the gameweek is not reopened. A
postponed fixture remains attached to its original gameweek and is scored
against that gameweek's locked squads when it is eventually played. Transfers
for later gameweeks do not change the earlier snapshot.

## Possible later additions

These ideas need more precise definitions or additional data and are excluded
from the first scoring version:

- **MVP bonus:** requires an objective performance-rating formula and tie rule.
- **Scout bonus:** could award +3 when a scoring player has less than 5%
  ownership at the deadline, but ownership must be snapshotted first.
- **Dynamic prices:** requires a published formula, price history, and clear
  rules for the sale value of already-owned players. Prices should not change
  during a locked gameweek.
- **Home/away record and last-five form:** useful player statistics, but not a
  pricing or scoring input until a formula is agreed.

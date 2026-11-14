type ScheduleGameweek = { id: string; stupa_round_id: number | null };
type ScheduleFixture = { fantasy_gameweek_id: string | null; stupa_round_id: number | null };

export function groupFixturesByGameweek<T extends ScheduleFixture>(
  fixtures: T[],
  gameweeks: ScheduleGameweek[],
) {
  const gameweeksByRound = new Map(gameweeks
    .filter((week) => week.stupa_round_id !== null)
    .map((week) => [week.stupa_round_id, week.id]));
  const groups = new Map<string | null, T[]>();
  for (const fixture of fixtures) {
    // Schedule presentation follows STUPA; the fantasy link may be frozen for
    // scoring against an earlier gameweek's locked squad snapshots.
    const id = gameweeksByRound.get(fixture.stupa_round_id) ?? fixture.fantasy_gameweek_id;
    const group = groups.get(id) ?? [];
    group.push(fixture);
    groups.set(id, group);
  }
  return groups;
}

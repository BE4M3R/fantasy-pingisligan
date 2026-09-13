export const MAX_PLAYERS_PER_CLUB = 2;
export const CLUB_LIMIT_MESSAGE = "Can only have 2 players from same club";

export function getOverLimitClubIds(clubIds: readonly (string | null)[]) {
  const counts = new Map<string, number>();
  for (const id of clubIds) {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > MAX_PLAYERS_PER_CLUB)
    .map(([id]) => id));
}

export function canTransferFromClub(
  clubIds: readonly (string | null)[],
  outgoingClubId: string | null,
) {
  const overLimit = getOverLimitClubIds(clubIds);
  return overLimit.size === 0 || (outgoingClubId !== null && overLimit.has(outgoingClubId));
}

export function canReplaceClub(
  clubIds: readonly (string | null)[],
  outgoingClubId: string | null,
  incomingClubId: string | null,
) {
  if (!canTransferFromClub(clubIds, outgoingClubId)) return false;
  if (!incomingClubId) return true;
  const remainingCount = clubIds.filter((id) => id === incomingClubId).length
    - Number(outgoingClubId === incomingClubId);
  return remainingCount < MAX_PLAYERS_PER_CLUB;
}

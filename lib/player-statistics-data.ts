import "server-only";
import type { TransferPlayer } from "@/app/dashboard/player-types";
import type { PlayerStatisticsWeek } from "@/lib/player-statistics";
import { createPublicClient } from "@/lib/supabase/public";

export type PlayerFixture = {
  id: string;
  starts_at: string | null;
  home_club_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_club: { name: string } | null;
  away_club: { name: string } | null;
  gameweek: { name: string; round_order: number | null } | null;
};

export type PlayerStatistics = {
  player: TransferPlayer;
  history: PlayerStatisticsWeek[];
  fixtures: PlayerFixture[];
};

export const isPlayerId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function getPlayerStatistics(id: string): Promise<PlayerStatistics | null> {
  const client = createPublicClient();
  const [roster, history] = await Promise.all([
    client.rpc("get_transfer_players", { p_player_id: id }),
    client.rpc("get_player_statistics_rows", { p_player_id: id }),
  ]);
  if (roster.error || history.error) throw new Error("Could not load player statistics.");
  const player = (roster.data as TransferPlayer[] | null)?.[0];
  if (!player) return null;
  const clubId = Array.isArray(player.clubs) ? player.clubs[0]?.id : player.clubs?.id;
  let fixtures: PlayerFixture[] = [];
  if (clubId) {
    // Round the lower bound to reuse the public cache across concurrent requests.
    const since = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    const result = await client.from("matches")
      .select("id, starts_at, home_club_id, home_team_name, away_team_name, home_club:clubs!matches_home_club_id_fkey(name), away_club:clubs!matches_away_club_id_fkey(name), gameweek:fantasy_gameweeks!matches_fantasy_gameweek_id_fkey(name, round_order)")
      .or(`home_club_id.eq.${clubId},away_club_id.eq.${clubId}`)
      .gte("starts_at", since)
      .neq("status", "scored")
      .order("starts_at").order("id").limit(3);
    if (result.error) throw new Error("Could not load upcoming fixtures.");
    fixtures = result.data as unknown as PlayerFixture[];
  }
  return { player, history: (history.data ?? []) as PlayerStatisticsWeek[], fixtures };
}

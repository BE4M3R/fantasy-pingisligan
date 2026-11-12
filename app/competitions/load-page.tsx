import { notFound } from "next/navigation";
import { getCompetition, getCompetitionArtwork, getCompetitionStandings, getCompetitionWinner } from "@/lib/competition-data";
import { CompetitionPage, CompetitionShell } from "./competition-page";

export async function LoadCompetitionPage({ gameweekId }: { gameweekId: string | null }) {
  const content = await getCompetition(gameweekId);
  if (content.error) return <CompetitionShell><p role="status" className="rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-6">Competition details are temporarily unavailable. Please try again.</p></CompetitionShell>;
  if (!content.competition) notFound();
  const [artwork, standings, announcement] = await Promise.all([
    getCompetitionArtwork(content.competition),
    gameweekId ? getCompetitionStandings(gameweekId, 0, 5) : null,
    gameweekId ? getCompetitionWinner(gameweekId) : { winner: null, error: false },
  ]);
  return <CompetitionPage competition={content.competition} artwork={artwork} gameweekId={gameweekId} standings={standings} winner={announcement.winner} winnerError={announcement.error} />;
}

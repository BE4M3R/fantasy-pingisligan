export type Competition = {
  gameweek_number: number | null;
  state: "upcoming" | "open" | "live" | "refreshing" | "previous" | "revealed";
  content_available: boolean;
  title: string;
  description: string | null;
  sponsor: string | null;
  image_path: string | null;
  image_alt: string | null;
  prize_title: string | null;
  prize_image_path: string | null;
  prize_image_alt: string | null;
  prize_description: string | null;
  prize_product_url: string | null;
  rules_markdown: string | null;
  details_markdown: string | null;
  prize_value_sek: number | string | null;
  rules_version: number | null;
  rules_title: string | null;
  public_path: `/competitions/${string}`;
};

export type CompetitionStandings = {
  rows: { rank: number; team_name: string; points: number }[];
  total_count: number;
  visible: boolean;
  refreshed: boolean;
  missing_scores: number;
  fixture_count: number;
  outstanding_fixtures: number;
};

export const isGameweekId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function formatPrizeValue(value: number | string | null | undefined, language: "sv" | "en" = "en") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return undefined;
  return new Intl.NumberFormat(language === "sv" ? "sv-SE" : "en-GB", {
    style: "currency", currency: "SEK", maximumFractionDigits: 0,
  }).format(Number(value));
}

export function competitionStatus(competition: Competition) {
  if (competition.gameweek_number === null) return competition.state === "upcoming" ? "Upcoming" : "Season competition";
  if (competition.state === "upcoming") return "Upcoming";
  if (competition.state === "open") return "Open";
  if (competition.state === "live") return "In progress";
  if (competition.state === "refreshing") return "Awaiting results";
  // A refresh ends this lifecycle stage; it never confirms a prize winner.
  return "Gameweek ended";
}

export function competitionResult(competition: Competition) {
  if (competition.gameweek_number === null) return {
    title: "A season to remember",
    message: "The season winner will be announced here after the season ends and the final results and eligibility have been verified.",
  };
  if (competition.state === "previous") return {
    title: "The Gameweek is over. Who takes the prize?",
    message: "The winner will be announced here once the results, any outstanding fixtures and eligibility have been verified and the winner has been confirmed.",
  };
  if (competition.state === "refreshing") return {
    title: "Awaiting the final results",
    message: "The winner will be announced here after all relevant results and eligibility have been verified and the winner has been confirmed.",
  };
  return {
    title: competition.state === "live" ? "The competition is in play" : "Your Gameweek. Your chance to shine.",
    message: `The winner will be announced here after Gameweek ${competition.gameweek_number} ends, once the results and eligibility have been verified.`,
  };
}

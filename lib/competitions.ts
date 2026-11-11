export type Competition = {
  gameweek_number: number | null;
  state: "upcoming" | "open" | "live" | "refreshing" | "previous" | "revealed";
  content_available: boolean;
  title: string;
  description: string | null;
  sponsor: string | null;
  image_path: string | null;
  image_alt: string | null;
  prize_image_path: string | null;
  prize_image_alt: string | null;
  prize_description: string | null;
  prize_product_url: string | null;
  prize_value_sek: number | string | null;
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

export function gameweekCompetitionTitle(number: number | null) {
  return number === null ? "Gameweek competition" : `Gameweek ${number} competition`;
}

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
  return "Awaiting winner confirmation";
}

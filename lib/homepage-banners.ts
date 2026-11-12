import type { CompetitionWinner } from "./competitions";

export type HomepageCompetition = {
  id: string;
  kind: "gameweek" | "season";
  gameweek_number: number | null;
  state: "upcoming" | "open" | "live" | "refreshing" | "previous" | "revealed";
  is_current: boolean;
  title: string;
  prize_title: string | null;
  teaser: string | null;
  sponsor: string | null;
  image_path: string | null;
  image_alt: string | null;
  cta_url: string | null;
  winner?: CompetitionWinner | null;
};

export type HomepageSlide = Omit<HomepageCompetition, "image_path" | "gameweek_number"> & {
  gameweekLabel?: string;
  imageUrl?: string;
};

// SQL owns ordering, competition opt-ins and authorization. Keep locked client
// prize payloads generic as additional defense, never as the disclosure boundary.
// Public teaser copy is intentionally retained before prize reveal.
export function buildHomepageCards(rows: HomepageCompetition[]) {
  return rows.map(({ gameweek_number, ...row }) => {
    const defaultTitle = row.kind === "season" ? "Season Competition" : `Gameweek ${gameweek_number} competition`;
    return {
      ...row,
      ...(row.state === "upcoming" ? {
        title: defaultTitle,
        prize_title: null,
        sponsor: null, image_path: null, image_alt: null,
        cta_url: row.kind === "season" ? "/competitions/season" : null,
        winner: null,
      } : {}),
      gameweekLabel: gameweek_number === null || row.title === defaultTitle || row.state === "upcoming"
        ? undefined : `GW ${gameweek_number}`,
    };
  });
}

export function defaultHomepageSlideIndex(
  slides: Pick<HomepageSlide, "id" | "is_current" | "state" | "winner">[],
  previousGameweek: { id: string; unlock_at: string } | null = null,
  now = Date.now(),
) {
  const unlockedAt = Date.parse(previousGameweek?.unlock_at ?? "");
  const winnerPriorityId = previousGameweek && now >= unlockedAt && now < unlockedAt + 48 * 60 * 60 * 1000
    ? `gameweek:${previousGameweek.id}` : null;
  const winner = slides.findIndex((slide) => slide.id === winnerPriorityId && slide.state === "previous" && slide.winner);
  if (winner >= 0) return winner;
  const current = slides.findIndex((slide) => slide.is_current);
  if (current >= 0) return current;
  const latestCompleted = slides.findLastIndex((slide) => slide.state === "previous");
  return Math.max(0, latestCompleted);
}

export type HomepageCompetition = {
  id: string;
  kind: "gameweek" | "season";
  gameweek_number: number | null;
  state: "upcoming" | "open" | "live" | "refreshing" | "previous" | "revealed";
  is_current: boolean;
  title: string;
  description: string | null;
  sponsor: string | null;
  image_path: string | null;
  image_alt: string | null;
  cta_url: string | null;
};

export type HomepageSlide = Omit<HomepageCompetition, "image_path" | "gameweek_number"> & {
  gameweekLabel?: string;
  imageUrl?: string;
};

// SQL owns ordering, the two-teaser limit and authorization. Keep locked client
// payloads generic as additional defense, never as the disclosure boundary.
export function buildHomepageCards(rows: HomepageCompetition[]) {
  return rows.map(({ gameweek_number, ...row }) => {
    const defaultTitle = row.kind === "season" ? "Season Competition" : `Gameweek ${gameweek_number} competition`;
    return {
      ...row,
      ...(row.state === "upcoming" ? {
        title: defaultTitle,
        description: null, sponsor: null, image_path: null, image_alt: null,
        cta_url: row.kind === "season" ? "/competitions/season" : null,
      } : {}),
      gameweekLabel: gameweek_number === null || row.title === defaultTitle || row.state === "upcoming"
        ? undefined : `GW ${gameweek_number}`,
    };
  });
}

export function defaultHomepageSlideIndex(slides: Pick<HomepageSlide, "is_current" | "state">[]) {
  const current = slides.findIndex((slide) => slide.is_current);
  if (current >= 0) return current;
  const latestCompleted = slides.findLastIndex((slide) => slide.state === "previous");
  return Math.max(0, latestCompleted);
}

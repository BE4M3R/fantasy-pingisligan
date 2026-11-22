import type { HomepageCompetition } from "@/lib/homepage-banners";

export function CompetitionStatusBadge({ state, winner }: Pick<HomepageCompetition, "state" | "winner">) {
  const label = winner ? "Winner announced"
    : state === "upcoming" ? "Coming soon"
      : state === "previous" ? "Winner pending" : "Ongoing";

  return (
    <span className="sponsored-status shrink-0 whitespace-nowrap rounded-md border border-[var(--pf-brand-blue-hover)]/30 bg-[var(--pf-navy)]/80 px-1.5 py-0.5 text-[10px] font-bold leading-4 text-[var(--pf-text)] sm:px-2 sm:text-xs">
      {label}
    </span>
  );
}

import { notFound } from "next/navigation";
import { competitionsEnabled } from "@/lib/competition-publication";
import { LoadCompetitionPage } from "@/app/competitions/load-page";
import { getCompetition } from "@/lib/competition-data";
import { publicPageMetadata } from "@/lib/seo";

export async function generateMetadata() {
  if (!await competitionsEnabled()) return { title: "Not found", robots: { index: false, follow: false } };
  const { competition } = await getCompetition(null);
  return publicPageMetadata("/competitions/season", `${competition?.title ?? "Season Competition"} | Pingisligan Fantasy`,
    competition?.description ?? "Explore the Season Competition prize and winner announcement.");
}

export default async function Page() {
  if (!await competitionsEnabled()) notFound();
  return <LoadCompetitionPage gameweekId={null} />;
}

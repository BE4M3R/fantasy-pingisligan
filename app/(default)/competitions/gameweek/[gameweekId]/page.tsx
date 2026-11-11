import { competitionsEnabled } from "@/lib/competition-publication";
import { notFound, permanentRedirect } from "next/navigation";
import { LoadCompetitionPage } from "@/app/competitions/load-page";
import { getCompetition, resolveCompetitionGameweek } from "@/lib/competition-data";
import { gameweekCompetitionTitle, isGameweekId } from "@/lib/competitions";
import { publicPageMetadata } from "@/lib/seo";

type Props = { params: Promise<{ gameweekId: string }> };

async function resolve(value: string) {
  const id = isGameweekId(value) ? value : await resolveCompetitionGameweek(value);
  if (!id) notFound();
  return id;
}

export async function generateMetadata({ params }: Props) {
  if (!await competitionsEnabled()) return { title: "Not found", robots: { index: false, follow: false } };
  const { gameweekId: value } = await params;
  const id = await resolve(value);
  const { competition, error } = await getCompetition(id);
  if (!competition && !error) notFound();
  return publicPageMetadata(competition?.public_path ?? `/competitions/gameweek/${value}`,
    `${competition?.title ?? "Gameweek competition"}${competition && competition.title !== gameweekCompetitionTitle(competition.gameweek_number) ? ` · Gameweek ${competition.gameweek_number}` : ""} | Pingisligan Fantasy`,
    competition?.description ?? "Follow Gameweek competition prizes and winner announcements on Pingisligan Fantasy.");
}

export default async function Page({ params }: Props) {
  if (!await competitionsEnabled()) notFound();
  const { gameweekId: value } = await params;
  const id = await resolve(value);
  const { competition, error } = await getCompetition(id);
  if (!competition && !error) notFound();
  if (isGameweekId(value) && competition && competition.public_path !== `/competitions/gameweek/${value}`) {
    permanentRedirect(competition.public_path);
  }
  return <LoadCompetitionPage gameweekId={id} />;
}

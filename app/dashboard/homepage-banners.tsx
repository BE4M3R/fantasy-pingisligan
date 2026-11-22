import { competitionsEnabled } from "@/lib/competition-publication";
import { createClient } from "@/lib/supabase/server";
import { getCompetitionHighlights, getCompetitionSponsorUrls } from "@/lib/competition-highlights";
import { buildHomepageCards, defaultHomepageSlideIndex } from "@/lib/homepage-banners";
import { SponsoredCarousel } from "./sponsored-carousel";

export async function HomepageBanners() {
  if (!await competitionsEnabled()) return null;
  const supabase = await createClient();
  const [{ rows, error, winners, winnerError }, previousGameweek] = await Promise.all([
    getCompetitionHighlights(),
    supabase.from("fantasy_gameweeks").select("id,unlock_at")
      .not("data_refreshed_at", "is", null)
      .order("lock_at", { ascending: false }).order("id", { ascending: false })
      .limit(1).maybeSingle(),
  ]);
  if (error) return <p role="status" className="px-4 py-8 text-sm text-[var(--pf-text-muted)]">Competition highlights temporarily unavailable.</p>;
  const banners = buildHomepageCards(rows.map((banner) => ({
    ...banner, winner: winners.get(banner.id) ?? null,
  })));
  // Decide once on the server so hydration and browser clocks cannot change
  // which card leads Home. Older winners never inherit this priority window.
  const initialIndex = defaultHomepageSlideIndex(banners, previousGameweek.data);
  const urls = await getCompetitionSponsorUrls(banners.map((banner) => banner.image_path));
  return <div className="homepage-banner-breakout">
    {winnerError ? <p role="status" className="px-4 py-2 text-sm text-[var(--pf-text-muted)]">Winner announcements temporarily unavailable.</p> : null}
    <SponsoredCarousel initialIndex={initialIndex} slides={banners.map(({ image_path, ...banner }) => ({
    ...banner, imageUrl: image_path ? urls.get(image_path) ?? undefined : undefined,
  }))} /></div>;
}

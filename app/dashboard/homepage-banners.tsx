import { competitionsEnabled } from "@/lib/competition-publication";
import { createClient } from "@/lib/supabase/server";
import { buildHomepageCards, defaultHomepageSlideIndex, type HomepageCompetition } from "@/lib/homepage-banners";
import { SponsoredCarousel } from "./sponsored-carousel";
import type { CompetitionWinner } from "@/lib/competitions";

export async function HomepageBanners() {
  if (!await competitionsEnabled()) return null;
  const supabase = await createClient();
  // Invoker RPC + RLS share database time for lifecycle and disclosure.
  const [{ data, error }, announcements, previousGameweek] = await Promise.all([
    supabase.rpc("get_homepage_competitions").select("id,kind,gameweek_number,state,is_current,title,prize_title:description,teaser:cta_label,sponsor,image_path,image_alt,cta_url"),
    supabase.rpc("get_public_competition_winners"),
    supabase.from("fantasy_gameweeks").select("id,unlock_at")
      .not("data_refreshed_at", "is", null)
      .order("lock_at", { ascending: false }).order("id", { ascending: false })
      .limit(1).maybeSingle(),
  ]);
  if (error) return <p role="status" className="px-4 py-8 text-sm text-[var(--pf-text-muted)]">Competition highlights temporarily unavailable.</p>;
  const winners = new Map(((announcements.data ?? []) as CompetitionWinner[]).map((winner) => [`gameweek:${winner.gameweek_id}`, winner]));
  const banners = buildHomepageCards(((data ?? []) as HomepageCompetition[]).map((banner) => ({
    ...banner, winner: winners.get(banner.id) ?? null,
  })));
  // Decide once on the server so hydration and browser clocks cannot change
  // which card leads Home. Older winners never inherit this priority window.
  const initialIndex = defaultHomepageSlideIndex(banners, previousGameweek.data);
  const paths = [...new Set(banners.flatMap((banner) => banner.image_path ? [banner.image_path] : []))];
  const signed = paths.length
    ? await supabase.storage.from("announcement-artwork").createSignedUrls(paths, 300)
    : null;
  const urls = new Map(signed?.data?.map((item) => [item.path, item.signedUrl]));
  return <div className="homepage-banner-breakout">
    {announcements.error ? <p role="status" className="px-4 py-2 text-sm text-[var(--pf-text-muted)]">Winner announcements temporarily unavailable.</p> : null}
    <SponsoredCarousel initialIndex={initialIndex} slides={banners.map(({ image_path, ...banner }) => ({
    ...banner, imageUrl: image_path ? urls.get(image_path) ?? undefined : undefined,
  }))} /></div>;
}

import { createClient } from "@/lib/supabase/server";
import { buildHomepageCards, type HomepageCompetition } from "@/lib/homepage-banners";
import { SponsoredCarousel } from "./sponsored-carousel";

export async function HomepageBanners() {
  const supabase = await createClient();
  // Invoker RPC + RLS share database time for lifecycle and disclosure.
  const { data, error } = await supabase.rpc("get_homepage_competitions");
  if (error) return <p role="status" className="px-4 py-8 text-sm text-[var(--pf-text-muted)]">Competition highlights temporarily unavailable.</p>;
  const banners = buildHomepageCards((data ?? []) as HomepageCompetition[]);
  const paths = [...new Set(banners.flatMap((banner) => banner.image_path ? [banner.image_path] : []))];
  const signed = paths.length
    ? await supabase.storage.from("announcement-artwork").createSignedUrls(paths, 300)
    : null;
  const urls = new Map(signed?.data?.map((item) => [item.path, item.signedUrl]));
  return <SponsoredCarousel slides={banners.map(({ image_path, ...banner }) => ({
    ...banner, imageUrl: image_path ? urls.get(image_path) ?? undefined : undefined,
  }))} />;
}

export function HomepageBannersLoading() {
  return <div aria-label="Loading gameweek highlights" role="status" className="flex h-36 items-center justify-center rounded-xl border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] px-4 sm:px-6">
    <span aria-hidden="true" className="h-5 w-3/5 rounded bg-[var(--pf-navy-elevated)]" />
  </div>;
}

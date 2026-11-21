import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CompetitionWinner } from "./competitions";
import type { HomepageCompetition } from "./homepage-banners";

export async function getCompetitionHighlights() {
  const supabase = await createClient();
  // Invoker RPC + RLS share database time for lifecycle and disclosure.
  const [rows, announcements] = await Promise.all([
    supabase.rpc("get_homepage_competitions").select("id,kind,gameweek_number,state,is_current,title,prize_title:description,teaser:cta_label,sponsor,image_path,image_alt,cta_url,prize_reveal_at"),
    supabase.rpc("get_public_competition_winners"),
  ]);
  return {
    rows: (rows.data ?? []) as HomepageCompetition[],
    error: rows.error,
    winners: new Map(((announcements.data ?? []) as CompetitionWinner[]).map((winner) => [`gameweek:${winner.gameweek_id}`, winner])),
    winnerError: announcements.error,
  };
}

export async function getCompetitionSponsorUrls(imagePaths: (string | null | undefined)[]) {
  const paths = [...new Set(imagePaths.filter((path): path is string => Boolean(path)))];
  if (!paths.length) return new Map<string, string>();

  const supabase = await createClient();
  const { data } = await supabase.storage.from("announcement-artwork").createSignedUrls(paths, 300);
  const urls = new Map<string, string>();
  for (const { path, signedUrl } of data ?? []) {
    if (path && signedUrl) urls.set(path, signedUrl);
  }
  return urls;
}

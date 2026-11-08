import { competitionsEnabled } from "@/lib/competition-publication";
import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import { formatPrizeValue } from "@/lib/competitions";
import { safeBannerUrl } from "@/lib/announcements";
import { CompetitionArtwork } from "./artwork";

type Promotion = {
  kind: "gameweek" | "season"; gameweek_number: number | null; content_available: boolean;
  title: string; description: string | null; sponsor: string | null; prize_title: string | null;
  prize_value_sek: number | string | null; image_path: string | null; image_alt: string | null; public_path: string;
};

export async function PublicCompetitionPromotions({ language }: { language: "sv" | "en" }) {
  if (!await competitionsEnabled()) return null;
  const db = createPublicClient({ fresh: true });
  const { data, error } = await db.rpc("get_public_competition_promotions");
  if (error) return <div className="mt-6 text-sm"><Link className="font-semibold text-[var(--pf-logo-gold)] underline underline-offset-4" href="/competitions/season">{language === "sv" ? "Upptäck våra tävlingar" : "Explore our competitions"} →</Link></div>;
  const promotions = (data ?? []) as Promotion[];
  const paths = [...new Set(promotions.flatMap((p) => p.image_path ? [p.image_path] : []))];
  const signed = paths.length ? await db.storage.from("announcement-artwork").createSignedUrls(paths, 300) : null;
  const images = new Map(signed?.data?.map((item) => [item.path, item.signedUrl]));
  const sv = language === "sv";
  return <section aria-label={sv ? "Tävlingar" : "Competitions"} className={`mt-6 grid gap-3 ${promotions.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
    {promotions.map((p) => <Link key={p.kind} href={safeBannerUrl(p.public_path) ?? "/competitions/season"}
      className="group min-w-0 rounded-xl border border-[var(--pf-logo-gold)]/25 bg-[var(--pf-navy)] p-3.5 transition hover:border-[var(--pf-logo-gold)]/70 focus-visible:outline-2 focus-visible:outline-[var(--pf-logo-gold)]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--pf-logo-gold)]">{p.kind === "gameweek" ? `${sv ? "Veckans tävling" : "Weekly competition"} · GW ${p.gameweek_number}` : sv ? "Säsongens stora pris" : "The season prize"}</p>
          <h2 className="mt-1 break-words text-base font-bold leading-5">{p.title}</h2>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--pf-text-muted)]">{p.content_available ? p.prize_title ?? p.description ?? (sv ? "Se pris och tävlingsinformation" : "Discover the prize and competition") : sv ? "Priset avslöjas snart" : "Prize details coming soon"}</p>
        </div>
        <div className="hidden lg:block"><CompetitionArtwork compact src={p.image_path ? images.get(p.image_path) ?? undefined : undefined} alt={p.image_alt ?? "Competition prize"} /></div>
        <span aria-hidden="true" className="shrink-0 text-lg text-[var(--pf-logo-gold)]">→</span>
      </div>
      {p.sponsor || formatPrizeValue(p.prize_value_sek, language) ? <div className="mt-2 space-y-0.5 text-[11px] leading-4">
        {p.sponsor ? <p className="truncate text-[var(--pf-text-muted)]" title={p.sponsor}>{p.sponsor}</p> : null}
        {formatPrizeValue(p.prize_value_sek, language) ? <p className="font-semibold text-[var(--pf-logo-gold)]">{sv ? "Ca" : "Approx."} {formatPrizeValue(p.prize_value_sek, language)}</p> : null}
      </div> : null}
    </Link>)}
  </section>;
}

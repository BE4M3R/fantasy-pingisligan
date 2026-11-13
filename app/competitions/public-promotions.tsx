import { competitionsEnabled } from "@/lib/competition-publication";
import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import { competitionDisplayTitle, formatPrizeValue, gameweekCompetitionTitle } from "@/lib/competitions";
import { formatPrizeRevealDate } from "@/lib/homepage-banners";
import { safeBannerUrl } from "@/lib/announcements";

type Promotion = {
  kind: "gameweek" | "season"; gameweek_number: number | null; content_available: boolean;
  title: string; prize_title: string | null;
  description: string | null; prize_reveal_at: string | null;
  prize_value_sek: number | string | null; public_path: string;
};

export async function PublicCompetitionPromotions({ language }: { language: "sv" | "en" }) {
  if (!await competitionsEnabled()) return null;
  const db = createPublicClient({ fresh: true });
  const { data, error } = await db.rpc("get_public_competition_promotions")
    .select("kind,gameweek_number,content_available,title,description,prize_title,prize_value_sek,public_path,prize_reveal_at");
  if (error) return null;
  const promotions = ((data ?? []) as Promotion[]).filter((p) => safeBannerUrl(p.public_path));
  if (!promotions.length) return null;
  const sv = language === "sv";
  return <section aria-label={sv ? "Tävlingar" : "Competitions"} className="mt-6 overflow-hidden rounded-xl border border-[var(--pf-logo-gold)]/30 bg-[var(--pf-navy)]">
    <header className="border-b border-[var(--pf-logo-gold)]/25 bg-[var(--pf-navy-elevated)] px-4 py-4">
      <h2 className="text-center text-lg font-bold leading-6 text-[var(--pf-text)] sm:text-xl sm:leading-7">
        {sv ? "Tävla om spännande Gameweek-priser varje vecka!" : "Compete for exciting Gameweek prizes every week!"}
      </h2>
    </header>
    <div className={`grid grid-cols-1 gap-px bg-[var(--pf-logo-gold)]/25 ${promotions.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {promotions.map((p) => {
        const revealed = p.content_available;
        const title = revealed ? p.prize_title ?? competitionDisplayTitle(p.title)
          : p.kind === "gameweek" ? gameweekCompetitionTitle(p.gameweek_number) : sv ? "Säsongstävling" : "Season Competition";
        const value = revealed ? formatPrizeValue(p.prize_value_sek, language) : undefined;
        const revealDate = !revealed ? formatPrizeRevealDate(p.prize_reveal_at) : undefined;
        return <Link key={p.kind} href={p.public_path}
          className="group flex min-w-0 cursor-pointer flex-col bg-[var(--pf-navy)] p-4 transition-[background-color,transform,box-shadow] duration-150 hover:bg-[var(--pf-navy-elevated)] active:scale-[0.985] active:bg-[var(--pf-brand-blue-soft)] active:ring-2 active:ring-inset active:ring-[var(--pf-logo-gold)]/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--pf-logo-gold)] motion-reduce:transition-none motion-reduce:active:scale-100">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--pf-logo-gold)]">{p.kind === "gameweek" ? sv ? "Pristävling" : "Prize competition" : sv ? "Säsongens stora pris" : "The season prize"}{p.kind === "gameweek" && revealed && p.prize_title ? ` · Gameweek ${p.gameweek_number}` : ""}</p>
          <h3 className="mt-1 break-words text-base font-bold leading-5">{title}</h3>
          {!revealed ? <p className="mt-2 break-words text-sm leading-5 text-[var(--pf-text-muted)]">{p.description ?? (sv ? "Priset avslöjas snart." : "Prize details coming soon.")}</p> : null}
          {revealDate ? <p className="mt-2 text-xs leading-5 text-[var(--pf-text-muted)]">{sv ? "Priset avslöjas" : "Prize reveal"}: <time dateTime={p.prize_reveal_at ?? undefined}>{revealDate}</time></p> : null}
          {value ? <p className="mt-2 text-[11px] font-semibold leading-4 text-[var(--pf-logo-gold)]">{sv ? "Ca" : "Approx."} {value}</p> : null}
          <div className="mt-auto flex items-end justify-between gap-3 pt-3">
            <span className="text-xs leading-5 text-[var(--pf-text-muted)]">{sv ? "Se tävlingen" : "View competition"}</span>
            <span aria-hidden="true" className="shrink-0 text-lg leading-5 text-[var(--pf-logo-gold)] transition-transform duration-150 group-hover:translate-x-1 group-active:translate-x-2 motion-reduce:group-hover:translate-x-0 motion-reduce:group-active:translate-x-0 motion-reduce:transition-none">→</span>
          </div>
        </Link>;
      })}
    </div>
  </section>;
}

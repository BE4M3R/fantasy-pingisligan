import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicFooter } from "@/app/public-footer";
import { getClaims } from "@/lib/supabase/server";
import {
  HOME_SEO,
  type HomeLanguage,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";

const homeCopy = {
  sv: {
    login: "Logga in",
    heading: "Skapa ditt Pingisligan",
    headingAccent: "Fantasy-lag",
    getStarted: "Kom igång",
    featureHeading: "Fantasy för svensk bordtennis",
    featureText: "Bygg ditt bästa möjliga fantasy pingisligan-lag",
    squadAlt: "Exempel på ett fantasylag på en bordtennisplan",
    friendsHeading: "Tävla mot dina vänner",
    friendsText: "Samla fantasypoäng från riktiga Pingisligan-matcher.",
    leagueAlt: "Tabell för en fantasyliga",
    languageLabel: "Välj språk",
  },
  en: {
    login: "Log in",
    heading: "Build your pingligan",
    headingAccent: "fantasy team",
    getStarted: "Get started",
    featureHeading: "Fantasy for Swedish table tennis",
    featureText: "Build your fantasy team with players from Pingisligan.",
    squadAlt: "Example fantasy team on a table tennis court",
    friendsHeading: "Compete with your friends",
    friendsText: "Earn fantasy points from real Pingisligan matches.",
    leagueAlt: "Fantasy league standings",
    languageLabel: "Choose language",
  },
} satisfies Record<HomeLanguage, {
  login: string;
  heading: string;
  headingAccent: string;
  getStarted: string;
  featureHeading: string;
  featureText: string;
  squadAlt: string;
  friendsHeading: string;
  friendsText: string;
  leagueAlt: string;
  languageLabel: string;
}>;

export async function Homepage({ language }: { language: HomeLanguage }) {
  const copy = homeCopy[language];
  const seo = HOME_SEO[language];
  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: `${SITE_URL}${seo.path}`,
    description: seo.description,
    inLanguage: language,
  };
  const { data } = await getClaims();
  const claims = data?.claims;

  if (claims?.sub) {
    redirect("/dashboard/overview");
  }

  return (
    <main className="table-tennis-surface flex min-h-screen flex-col text-[var(--pf-text)]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(websiteSchema).replace(/</g, "\\u003c"),
        }}
      />
      <header className="border-b border-white/15 bg-[var(--pf-navy-deep)]/70 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5">
          <Link
            aria-label="Fantasy Pingisligan"
            className="flex min-w-0 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-text)]"
            href={seo.path}
          >
            <Image
              alt=""
              className="h-10 w-10 shrink-0 sm:h-11 sm:w-11"
              height={44}
              priority
              src="/branding/pingisligan-fantasy-mark-transparent-v2.png"
              unoptimized
              width={44}
            />
            <Image
              alt=""
              className="h-auto min-w-0 w-[132px] sm:w-[154px] sm:shrink-0"
              height={35}
              priority
              src="/branding/pingisligan-fantasy-wordmark-transparent-v2.png"
              unoptimized
              width={154}
            />
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <div
              aria-label={copy.languageLabel}
              role="group"
              className="flex items-center gap-1 text-xs font-semibold"
            >
              {(["sv", "en"] as const).map((option, index) => (
                <span key={option} className="flex items-center gap-1">
                  {index > 0 && (
                    <span aria-hidden="true" className="text-[var(--pf-text-muted)]">|</span>
                  )}
                  <Link
                    href={HOME_SEO[option].path}
                    hrefLang={option}
                    lang={option}
                    aria-label={option === "sv" ? "Svenska" : "English"}
                    aria-current={language === option ? "page" : undefined}
                    className={`rounded-sm px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-text)] ${language === option ? "text-[var(--pf-logo-gold)]" : "text-[var(--pf-text-muted)] hover:text-[var(--pf-text)]"}`}
                  >
                    {option.toUpperCase()}
                  </Link>
                </span>
              ))}
            </div>
            <Link
              className="shrink-0 whitespace-nowrap rounded-md border border-white/25 bg-white/5 px-3 py-2 text-sm font-bold text-[var(--pf-text)] transition hover:border-white/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy-deep)] sm:px-4"
              href="/login"
            >
              {copy.login}
            </Link>
          </div>
        </nav>
      </header>

      <section className="mx-auto grid w-full max-w-6xl flex-1 content-center gap-x-10 gap-y-8 overflow-hidden px-5 py-8 sm:px-6 sm:py-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight min-[380px]:text-5xl sm:text-6xl">
            {copy.heading}{" "}
            <span className="text-[var(--pf-logo-gold)]">{copy.headingAccent}</span>
          </h1>

          <div className="mt-8">
            <Link
              className="block w-full rounded-lg bg-[var(--pf-logo-gold)] px-6 py-4 text-center text-base font-black text-[var(--pf-navy-deep)] shadow-lg shadow-[var(--pf-navy-deep)]/30 ring-2 ring-[var(--pf-logo-gold-ring)]/80 transition hover:bg-[var(--pf-logo-gold-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--pf-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy-deep)] sm:inline-block sm:w-auto"
              href="/signup"
            >
              {copy.getStarted}
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:gap-6">
          <div className="table-panel grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-3 overflow-hidden rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-4 sm:p-5">
            <div>
              <h2 className="text-base font-semibold text-[var(--pf-text)] sm:text-lg">{copy.featureHeading}</h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--pf-text-muted)]">
                {copy.featureText}
              </p>
            </div>
            <Image
              alt={copy.squadAlt}
              className="h-auto w-full rounded-md border border-white/15 shadow-lg shadow-[var(--pf-navy-deep)]/35"
              height={272}
              priority
              sizes="(max-width: 640px) 42vw, 176px"
              src="/features/build-squad-start-page.png"
              width={411}
            />
          </div>

          <div className="table-panel grid min-h-28 grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-3 overflow-hidden rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-4 sm:p-5">
            <div>
              <h2 className="text-base font-semibold text-[var(--pf-text)] sm:text-lg">
                {copy.friendsHeading}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--pf-text-muted)]">
                {copy.friendsText}
              </p>
            </div>
            <Image
              alt={copy.leagueAlt}
              className="h-auto w-full rounded-md border border-white/15 shadow-lg shadow-[var(--pf-navy-deep)]/35"
              height={365}
              sizes="(max-width: 640px) 42vw, 176px"
              src="/features/league-start-page.png"
              width={395}
            />
          </div>
        </div>

      </section>

      <PublicFooter language={language} />
    </main>
  );
}

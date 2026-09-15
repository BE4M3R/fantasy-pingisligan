import type { Metadata } from "next";

export const SITE_URL = "https://www.pingisliganfantasy.se";
export const SITE_NAME = "Pingisligan Fantasy";
export const HOME_TITLE = `${SITE_NAME} – Fantasy för svensk bordtennis`;
export const HOME_DESCRIPTION =
  "Spela Pingisligan Fantasy. Bygg ditt lag med spelare från Pingisligan, samla poäng från riktiga matcher och tävla mot dina vänner.";

export type HomeLanguage = "sv" | "en";

export const HOME_SEO = {
  sv: { path: "/", title: HOME_TITLE, description: HOME_DESCRIPTION, locale: "sv_SE" },
  en: {
    path: "/en",
    title: `${SITE_NAME} – Fantasy for Swedish table tennis`,
    description:
      "Play Pingisligan Fantasy. Build your team with Pingisligan players, earn points from real matches and compete with your friends.",
    locale: "en_US",
  },
} as const;

export const HOME_LANGUAGE_ALTERNATES = {
  sv: `${SITE_URL}/`,
  en: `${SITE_URL}/en`,
  "x-default": `${SITE_URL}/`,
};

const socialImage = {
  url: `${SITE_URL}/branding/pingisligan-fantasy-logo.png`,
  width: 1254,
  height: 1254,
  alt: "Pingisligan Fantasy – logotyp med bordtennisracket och krona",
};

// Set complete metadata per public page so social previews match the page,
// and private routes never inherit a public page's canonical URL.
// Use absolute URLs without metadataBase: Next.js 16 otherwise strips the
// trailing slash from the homepage canonical and Open Graph URL.
export function publicPageMetadata(
  path: "/" | "/en" | "/about" | "/rules",
  title: string,
  description: string,
): Metadata {
  const url = new URL(path, SITE_URL).href;

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      siteName: SITE_NAME,
      locale: "sv_SE",
      type: "website",
      url,
      title,
      description,
      images: [socialImage],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [socialImage],
    },
  };
}

export function homePageMetadata(language: HomeLanguage): Metadata {
  const { path, title, description, locale } = HOME_SEO[language];
  const metadata = publicPageMetadata(path, title, description);
  const image = {
    ...socialImage,
    alt: language === "en"
      ? "Pingisligan Fantasy – logo with a table tennis paddle and crown"
      : socialImage.alt,
  };

  return {
    ...metadata,
    alternates: {
      canonical: HOME_LANGUAGE_ALTERNATES[language],
      languages: HOME_LANGUAGE_ALTERNATES,
    },
    openGraph: {
      ...metadata.openGraph,
      locale,
      alternateLocale: HOME_SEO[language === "sv" ? "en" : "sv"].locale,
      images: [image],
    },
    twitter: { ...metadata.twitter, images: [image] },
  };
}

export type ClubLogo = {
  alt: string;
  match: string;
  src: string;
};

export const CLUB_LOGOS: ClubLogo[] = [
  { alt: "Eslövs logo", match: "eslov", src: "/club-logos/eslovs.webp" },
  {
    alt: "Söderhamn logo",
    match: "soderhamn",
    src: "/club-logos/soderhamn.webp",
  },
  { alt: "Rekord logo", match: "rekord", src: "/club-logos/rekord.webp" },
  {
    alt: "Halmstad logo",
    match: "halmstad",
    src: "/club-logos/halmstad.webp",
  },
  { alt: "Kosta logo", match: "kosta", src: "/club-logos/kosta.webp" },
  {
    alt: "Eskilstuna logo",
    match: "eskilstuna",
    src: "/club-logos/eskilstuna.webp",
  },
  {
    alt: "Spårvägen logo",
    match: "sparvagen",
    src: "/club-logos/sparvagen.webp",
  },
];

function searchable(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv-SE");
}

export function getClubLogo(clubName: string) {
  const normalizedClubName = searchable(clubName);

  return CLUB_LOGOS.find((logo) => normalizedClubName.includes(logo.match));
}

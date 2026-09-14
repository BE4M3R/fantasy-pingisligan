export const CLUBS = [
  {
    "key": "rekord",
    "name": "BTK Rekord",
    "aliases": [
      "BTK Rekord"
    ],
    "logo": "/club-logos/sbtf-rekord.jpg",
    "logoSource": "https://sbtf.se/wp-content/uploads/2022/11/btkrekord.jpg"
  },
  {
    "key": "eskilstuna",
    "name": "Eskilstuna by STIGA",
    "aliases": [
      "Linden BTK Eskilstuna",
      "Linden BTK Esklistuna"
    ],
    "logo": "/club-logos/sbtf-eskilstuna.jpg",
    "logoSource": "https://sbtf.se/wp-content/uploads/2025/08/Eskilstuna.jpg"
  },
  {
    "key": "eslovs",
    "name": "Eslövs AI BTK",
    "aliases": [
      "Eslövs AI"
    ],
    "logo": "/club-logos/sbtf-eslovs.png",
    "logoSource": "https://sbtf.se/wp-content/uploads/2022/11/eslov-logga-hemsida.png"
  },
  {
    "key": "halmstad",
    "name": "Halmstad BTK",
    "aliases": [],
    "logo": "/club-logos/sbtf-halmstad.png",
    "logoSource": "https://sbtf.se/wp-content/uploads/2022/11/halmstad.png"
  },
  {
    "key": "kosta",
    "name": "Kosta SK",
    "aliases": [],
    "logo": "/club-logos/sbtf-kosta.webp",
    "logoSource": "https://sbtf.se/wp-content/uploads/2025/08/Kosta-SK.webp"
  },
  {
    "key": "sparvagen",
    "name": "Spårvägens BTK",
    "aliases": [],
    "logo": "/club-logos/sbtf-sparvagen.png",
    "logoSource": "https://sbtf.se/wp-content/uploads/2022/11/sparvagen.png"
  },
  {
    "key": "soderhamn",
    "name": "Söderhamns UIF",
    "aliases": [],
    "logo": "/club-logos/sbtf-soderhamn.png",
    "logoSource": "https://sbtf.se/wp-content/uploads/2022/11/SUIFlogga-hogupplost.png"
  }
];

export function normalizeClubName(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv-SE").replace(/\*+$/, "").replace(/\s+/g, " ").trim();
}

export function getClub(value: string) {
  const name = normalizeClubName(value).replace(/^\[test\]\s*/, "");
  return CLUBS.find((club) => [club.name, ...club.aliases]
    .some((alias) => normalizeClubName(alias) === name));
}

export function canonicalClubName(value: string): string {
  const club = getClub(value);
  if (!club) return value.trim().replace(/\*+$/, "");

  const prefix = /^\s*\[test\]\s*/i.test(value) ? "[TEST] " : "";
  return `${prefix}${club.name}`;
}

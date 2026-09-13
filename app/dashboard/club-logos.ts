import { CLUBS, getClub } from "@/lib/clubs";

export const CLUB_LOGOS = CLUBS.map((club) => ({
  alt: `${club.name} logo`,
  match: club.key,
  src: club.logo,
}));

export type ClubLogo = (typeof CLUB_LOGOS)[number];

export function getClubLogo(clubName: string) {
  const club = getClub(clubName);
  return club ? CLUB_LOGOS.find((logo) => logo.match === club.key) : undefined;
}

import { redirect } from "next/navigation";

export default async function LegacyLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    invite?: string;
    league?: string;
    message?: string;
  }>;
}) {
  const legacyParams = await searchParams;
  const params = new URLSearchParams();

  if (legacyParams.invite) params.set("invite", legacyParams.invite);
  if (legacyParams.message) params.set("message", legacyParams.message);

  const query = params.toString();
  const destination = legacyParams.league
    ? `/dashboard/leagues/${encodeURIComponent(legacyParams.league)}`
    : "/dashboard/leagues";
  redirect(`${destination}${query ? `?${query}` : ""}`);
}

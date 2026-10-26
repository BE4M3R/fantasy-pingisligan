import { DashboardBottomNavigation } from "@/app/dashboard/bottom-navigation";
import { Announcements } from "@/app/dashboard/announcements/controller";
import { getClaims, getMyTeam } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { data } = await getClaims();
  const userId = data?.claims.sub;
  if (!userId) return children;
  const { data: team } = await getMyTeam(userId);
  const sessionId = String(data?.claims.session_id ?? "session");
  return (
    <Announcements
      key={`${userId}:${sessionId}`}
      ready={Boolean(team?.onboarding_completed)}
    >
      {children}
      <DashboardBottomNavigation />
    </Announcements>
  );
}

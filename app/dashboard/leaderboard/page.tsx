import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import {
  LeaderboardTable,
  type LeaderboardRow,
} from "@/app/dashboard/leaderboard-table";
import { createClient } from "@/lib/supabase/server";

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const [claimsResult, leaderboardResult] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.rpc("get_global_leaderboard"),
  ]);
  const userId = claimsResult.data?.claims.sub;

  if (!userId) {
    redirect("/login");
  }

  const { data: leaderboardRows, error: leaderboardError } = leaderboardResult;

  const leaderboard = (leaderboardRows ?? []) as LeaderboardRow[];

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <DashboardHeader activeTab="leaderboard" />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <section className="table-panel rounded-lg border p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-base font-bold">Leaderboard</h1>
              <p className="mt-1 text-sm text-sky-100/60">
                Fantasy teams sorted by total points.
              </p>
            </div>
          </div>

          {leaderboardError ? (
            <div className="mt-5 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              Run supabase/player-import-migration.sql in Supabase to enable
              the leaderboard.
            </div>
          ) : (
            <LeaderboardTable currentUserId={userId} rows={leaderboard} />
          )}
        </section>
      </section>
    </main>
  );
}

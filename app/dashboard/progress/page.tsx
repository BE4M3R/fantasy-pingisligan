import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import { ProgressTable, type ProgressRow } from "@/app/dashboard/progress-table";
import { createClient } from "@/lib/supabase/server";

export default async function ProgressPage() {
  const supabase = await createClient();
  const [claimsResult, progressResult] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.rpc("get_my_played_gameweek_progress"),
  ]);

  if (!claimsResult.data?.claims.sub) {
    redirect("/login");
  }

  const { data: progressRows, error: progressError } = progressResult;

  const progress = (progressRows ?? []) as ProgressRow[];

  return (
    <main className="dashboard-shell table-tennis-surface min-h-screen text-white">
      <DashboardHeader />

      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <section className="table-panel rounded-lg border p-4 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-[var(--pf-text)]">
                Progress
              </h1>
              <p className="mt-1 text-sm text-[var(--pf-text-muted)]">
                Compare your points with every fantasy team.
              </p>
            </div>
          </div>

          {progressError ? (
            <div className="mt-5 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              Run supabase/progress-gameweek-stats-migration.sql in Supabase to
              enable gameweek statistics.
            </div>
          ) : (
            <ProgressTable rows={progress} />
          )}
        </section>
      </section>
    </main>
  );
}

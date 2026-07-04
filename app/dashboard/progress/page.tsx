import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import { ProgressTable, type ProgressRow } from "@/app/dashboard/progress-table";
import { SeasonBanner } from "@/app/season-banner";
import { createClient } from "@/lib/supabase/server";

export default async function ProgressPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: progressRows, error: progressError } = await supabase.rpc(
    "get_my_gameweek_progress",
  );

  const progress = (progressRows ?? []) as ProgressRow[];

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <DashboardHeader activeTab="progress" />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6">
          <SeasonBanner />
        </div>

        <section className="table-panel rounded-lg border p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-base font-bold">Progress</h1>
              <p className="mt-1 text-sm text-sky-100/60">
                Your fantasy points by gameweek.
              </p>
            </div>
          </div>

          {progressError ? (
            <div className="mt-5 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              Run supabase/player-import-migration.sql in Supabase to enable
              progress tracking.
            </div>
          ) : (
            <ProgressTable rows={progress} />
          )}
        </section>
      </section>
    </main>
  );
}

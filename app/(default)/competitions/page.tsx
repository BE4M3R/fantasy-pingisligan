import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CompetitionOverview } from "@/app/competitions/overview";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import { DashboardLayout } from "@/app/dashboard/dashboard-layout";
import { getClaims } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Competitions | Pingisligan Fantasy",
  robots: { index: false, follow: false },
};

export default async function CompetitionsPage() {
  const { data } = await getClaims();
  if (!data?.claims.sub) redirect("/login");

  return (
    <DashboardLayout>
      <main className="dashboard-shell table-tennis-surface min-h-screen text-[var(--pf-text)]">
        <DashboardHeader />
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
          <h1 className="mb-5 text-3xl font-black tracking-tight sm:text-4xl">Competitions</h1>
          <Suspense fallback={<p role="status">Loading competitions…</p>}>
            <CompetitionOverview />
          </Suspense>
        </div>
      </main>
    </DashboardLayout>
  );
}

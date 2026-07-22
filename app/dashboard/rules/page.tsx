import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import { RulesContent } from "@/app/rules/rules-content";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Game rules | Fantasy Pingisligan",
  description: "A quick guide to squads, scoring, transfers, and chips.",
};

export default async function DashboardRulesPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) {
    redirect("/login");
  }

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <DashboardHeader activeTab="rules" />
      <RulesContent />
    </main>
  );
}

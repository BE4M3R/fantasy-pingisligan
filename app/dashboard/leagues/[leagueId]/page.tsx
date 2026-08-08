import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import {
  LeagueTable,
  type LeagueTableRow,
} from "@/app/dashboard/league-table";
import { InviteCode } from "@/app/dashboard/leagues/invite-code";
import { createClient } from "@/lib/supabase/server";

type PrivateLeague = {
  invite_code: string | null;
  is_owner: boolean;
  league_id: string;
  league_name: string;
  member_count: number | string;
};

export default async function LeaguePage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  const { leagueId } = await params;
  const query = await searchParams;
  const isGlobalLeague = leagueId === "global";
  const supabase = await createClient();
  const [claimsResult, initialResult] = await Promise.all([
    supabase.auth.getClaims(),
    isGlobalLeague
      ? supabase.rpc("get_global_leaderboard")
      : supabase.rpc("get_my_private_leagues"),
  ]);
  const userId = claimsResult.data?.claims.sub;

  if (!userId) {
    const nextPath = `/dashboard/leagues/${encodeURIComponent(leagueId)}`;
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const selectedLeague = isGlobalLeague
    ? null
    : ((initialResult.data ?? []) as PrivateLeague[]).find(
        (league) => league.league_id === leagueId,
      ) ?? null;

  if (!isGlobalLeague && !selectedLeague) {
    redirect(
      `/dashboard/leagues?message=${encodeURIComponent("League could not be found or you do not have access to it.")}`,
    );
  }

  const leagueResult = selectedLeague
    ? await supabase.rpc("get_private_league_leaderboard", {
        p_league_id: selectedLeague.league_id,
      })
    : initialResult;
  const leagueTable = (leagueResult.data ?? []) as LeagueTableRow[];

  return (
    <main className="dashboard-shell table-tennis-surface min-h-screen text-white">
      <DashboardHeader />

      <section className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <Link
          aria-label="Back to leagues"
          className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
          href="/dashboard/leagues"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="m15 18-6-6 6-6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </Link>

        {query.message ? (
          <div className="mb-5 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] px-4 py-3 text-sm text-[var(--pf-text)]">
            {query.message}
          </div>
        ) : null}

        <section className="table-panel min-w-0 rounded-lg border p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--pf-brand-blue)]">
                {selectedLeague ? "Private league" : "Overall"}
              </p>
              <h1 className="mt-1 text-xl font-black tracking-tight text-[var(--pf-text)]">
                {selectedLeague?.league_name ?? "Global league"}
              </h1>
              <p className="mt-1 text-sm text-[var(--pf-text-muted)]">
                {selectedLeague
                  ? `${Number(selectedLeague.member_count)} ${Number(selectedLeague.member_count) === 1 ? "member" : "members"}`
                  : "Fantasy teams sorted by total points."}
              </p>
            </div>

            {selectedLeague?.is_owner && selectedLeague.invite_code ? (
              <InviteCode code={selectedLeague.invite_code} />
            ) : null}
          </div>

          {leagueResult.error ? (
            <div className="mt-5 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              {selectedLeague
                ? "Private league table data could not be loaded. Run supabase/private-leaderboards-migration.sql in Supabase."
                : "Run supabase/player-import-migration.sql in Supabase to enable the league table."}
            </div>
          ) : (
            <LeagueTable currentUserId={userId} rows={leagueTable} />
          )}
        </section>
      </section>
    </main>
  );
}

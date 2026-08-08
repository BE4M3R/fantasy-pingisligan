import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import type { LeagueTableRow } from "@/app/dashboard/league-table";
import { joinPrivateLeague } from "@/app/dashboard/leagues/actions";
import { LeagueActions } from "@/app/dashboard/leagues/league-actions";
import { createClient } from "@/lib/supabase/server";

type PrivateLeague = {
  invite_code: string | null;
  is_owner: boolean;
  league_id: string;
  league_name: string;
  member_count: number | string;
  current_rank: number | string | null;
};

function privateLeagueHref(leagueId: string) {
  return `/dashboard/leagues/${encodeURIComponent(leagueId)}`;
}

export default async function LeaguesPage({
  searchParams,
}: {
  searchParams: Promise<{
    invite?: string;
    league?: string;
    message?: string;
  }>;
}) {
  const params = await searchParams;

  if (params.league) {
    const message = params.message
      ? `?message=${encodeURIComponent(params.message)}`
      : "";
    redirect(`${privateLeagueHref(params.league)}${message}`);
  }

  const supabase = await createClient();
  const inviteCode = params.invite
    ?.replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 8);
  const [claimsResult, globalResult, privateLeaguesResult] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.rpc("get_global_leaderboard"),
    supabase.rpc("get_my_private_leagues"),
  ]);
  const userId = claimsResult.data?.claims.sub;

  if (!userId) {
    const nextPath = inviteCode
      ? `/dashboard/leagues?invite=${encodeURIComponent(inviteCode)}`
      : "/dashboard/leagues";
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const privateLeagues = (privateLeaguesResult.data ?? []) as PrivateLeague[];
  const globalLeagueTable = (globalResult.data ?? []) as LeagueTableRow[];
  const globalRankIndex = globalLeagueTable.findIndex(
    (row) => row.user_id === userId,
  );
  const globalRank = globalRankIndex >= 0 ? globalRankIndex + 1 : null;
  const privateMigrationMissing = Boolean(privateLeaguesResult.error);
  const leagueLinkClass =
    "flex items-center justify-between gap-3 rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-3 text-sm text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue-border)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]";

  return (
    <main className="dashboard-shell table-tennis-surface min-h-screen text-white">
      <DashboardHeader />

      <section className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-5">
          <h1 className="text-2xl font-black tracking-tight text-[var(--pf-text)]">
            Leagues
          </h1>
        </div>

        {params.message ? (
          <div className="mb-5 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] px-4 py-3 text-sm text-[var(--pf-text)]">
            {params.message}
          </div>
        ) : null}

        {privateMigrationMissing ? (
          <div className="mb-5 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            Run supabase/private-leaderboards-migration.sql in Supabase to
            enable private leagues.
          </div>
        ) : null}

        {inviteCode ? (
          <section className="table-panel mb-5 rounded-lg border p-4 sm:p-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--pf-brand-blue)]">
              You have been invited
            </p>
            <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <h2 className="text-lg font-bold text-[var(--pf-text)]">
                  Join a private league
                </h2>
                <p className="mt-1 text-sm text-[var(--pf-text-muted)]">
                  Invitation code: {inviteCode}
                </p>
              </div>
              <form action={joinPrivateLeague}>
                <input name="invite_code" type="hidden" value={inviteCode} />
                <button className="w-full rounded-md bg-[var(--pf-brand-blue)] px-4 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)] sm:w-auto">
                  Join league
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {!privateMigrationMissing ? (
          <LeagueActions inviteCode={inviteCode} />
        ) : null}

        <section className="table-panel rounded-lg border p-4">
          <h2 className="font-bold text-[var(--pf-text)]">Your leagues</h2>

          <nav aria-label="League selection" className="mt-3 space-y-1.5">
            <Link className={leagueLinkClass} href="/dashboard/leagues/global">
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  Global league
                </span>
                <span className="mt-0.5 block text-xs font-normal text-[var(--pf-text-muted)]">
                  All fantasy teams
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-[var(--pf-fantasy-yellow)]/40 bg-[var(--pf-fantasy-yellow)]/10 px-2.5 py-1 text-sm font-black text-[var(--pf-fantasy-yellow)]">
                {globalRank ? `#${globalRank}` : "—"}
              </span>
            </Link>

            {privateLeagues.map((league) => (
              <Link
                className={leagueLinkClass}
                href={privateLeagueHref(league.league_id)}
                key={league.league_id}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {league.league_name}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-[var(--pf-text-muted)]">
                    Private league
                  </span>
                </span>
                <span className="shrink-0 rounded-full border border-[var(--pf-fantasy-yellow)]/40 bg-[var(--pf-fantasy-yellow)]/10 px-2.5 py-1 text-sm font-black text-[var(--pf-fantasy-yellow)]">
                  {league.current_rank ? `#${league.current_rank}` : "—"}
                </span>
              </Link>
            ))}
          </nav>
        </section>
      </section>
    </main>
  );
}

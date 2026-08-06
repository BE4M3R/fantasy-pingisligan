import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import {
  LeaderboardTable,
  type LeaderboardRow,
} from "@/app/dashboard/leaderboard-table";
import {
  joinPrivateLeaderboard,
} from "@/app/dashboard/leaderboard/actions";
import { InviteCode } from "@/app/dashboard/leaderboard/invite-code";
import { LeaderboardActions } from "@/app/dashboard/leaderboard/leaderboard-actions";
import { createClient } from "@/lib/supabase/server";

type PrivateLeague = {
  invite_code: string | null;
  is_owner: boolean;
  league_id: string;
  league_name: string;
  member_count: number | string;
  current_rank: number | string | null;
};

function privateLeaderboardHref(leagueId: string) {
  return `/dashboard/leaderboard?league=${encodeURIComponent(leagueId)}`;
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    invite?: string;
    league?: string;
    message?: string;
  }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;
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
      ? `/dashboard/leaderboard?invite=${encodeURIComponent(inviteCode)}`
      : "/dashboard/leaderboard";
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const privateLeagues = (privateLeaguesResult.data ?? []) as PrivateLeague[];
  const globalLeaderboard = (globalResult.data ?? []) as LeaderboardRow[];
  const globalRankIndex = globalLeaderboard.findIndex(
    (row) => row.user_id === userId,
  );
  const globalRank = globalRankIndex >= 0 ? globalRankIndex + 1 : null;
  const selectedLeague = params.league
    ? privateLeagues.find((league) => league.league_id === params.league) ?? null
    : null;
  const selectedResult = selectedLeague
    ? await supabase.rpc("get_private_league_leaderboard", {
        p_league_id: selectedLeague.league_id,
      })
    : globalResult;
  const leaderboard = selectedLeague
    ? ((selectedResult.data ?? []) as LeaderboardRow[])
    : globalLeaderboard;
  const leaderboardError = selectedResult.error;
  const privateMigrationMissing = Boolean(privateLeaguesResult.error);

  return (
    <main className="dashboard-shell table-tennis-surface min-h-screen text-white">
      <DashboardHeader />

      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-5">
          <h1 className="text-2xl font-black tracking-tight text-[var(--pf-text)]">
            Leaderboards
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
            enable private leaderboards.
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
                  Join a private leaderboard
                </h2>
                <p className="mt-1 text-sm text-[var(--pf-text-muted)]">
                  Invitation code: {inviteCode}
                </p>
              </div>
              <form action={joinPrivateLeaderboard}>
                <input name="invite_code" type="hidden" value={inviteCode} />
                <button className="w-full rounded-md bg-[var(--pf-brand-blue)] px-4 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)] sm:w-auto">
                  Join leaderboard
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {!privateMigrationMissing ? (
          <LeaderboardActions inviteCode={inviteCode} />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="table-panel h-fit rounded-lg border p-4">
            <h2 className="font-bold text-[var(--pf-text)]">Your leaderboards</h2>

            <nav aria-label="Leaderboard selection" className="mt-3 space-y-1.5">
              <Link
                aria-current={!selectedLeague ? "page" : undefined}
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-3 text-sm transition ${
                  !selectedLeague
                    ? "border-[var(--pf-brand-blue)] bg-[var(--pf-brand-blue-soft)] text-[var(--pf-text)]"
                    : "border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-text)] hover:border-[var(--pf-brand-blue-border)] hover:bg-[var(--pf-brand-blue-soft)]"
                }`}
                href="/dashboard/leaderboard"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    Global leaderboard
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
                  aria-current={
                    selectedLeague?.league_id === league.league_id
                      ? "page"
                      : undefined
                  }
                  className={`flex items-center justify-between gap-3 rounded-md border px-3 py-3 text-sm transition ${
                    selectedLeague?.league_id === league.league_id
                      ? "border-[var(--pf-brand-blue)] bg-[var(--pf-brand-blue-soft)] text-[var(--pf-text)]"
                      : "border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-text)] hover:border-[var(--pf-brand-blue-border)] hover:bg-[var(--pf-brand-blue-soft)]"
                  }`}
                  href={privateLeaderboardHref(league.league_id)}
                  key={league.league_id}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {league.league_name}
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-[var(--pf-text-muted)]">
                      Private leaderboard
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-[var(--pf-fantasy-yellow)]/40 bg-[var(--pf-fantasy-yellow)]/10 px-2.5 py-1 text-sm font-black text-[var(--pf-fantasy-yellow)]">
                    {league.current_rank ? `#${league.current_rank}` : "—"}
                  </span>
                </Link>
              ))}
            </nav>
          </aside>

          <section className="table-panel min-w-0 rounded-lg border p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 sm:gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--pf-brand-blue)]">
                  {selectedLeague ? "Private leaderboard" : "Overall"}
                </p>
                <h2 className="mt-1 text-xl font-black tracking-tight text-[var(--pf-text)]">
                  {selectedLeague?.league_name ?? "Global leaderboard"}
                </h2>
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

            {leaderboardError ? (
              <div className="mt-5 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
                {selectedLeague
                  ? "Private leaderboard data could not be loaded. Run supabase/private-leaderboards-migration.sql in Supabase."
                  : "Run supabase/player-import-migration.sql in Supabase to enable the leaderboard."}
              </div>
            ) : (
              <LeaderboardTable currentUserId={userId} rows={leaderboard} />
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

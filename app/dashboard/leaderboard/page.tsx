import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import {
  LeaderboardTable,
  type LeaderboardRow,
} from "@/app/dashboard/leaderboard-table";
import {
  createPrivateLeaderboard,
  joinPrivateLeaderboard,
} from "@/app/dashboard/leaderboard/actions";
import { InviteControls } from "@/app/dashboard/leaderboard/invite-controls";
import { createClient } from "@/lib/supabase/server";

type PrivateLeague = {
  invite_code: string | null;
  is_owner: boolean;
  league_id: string;
  league_name: string;
  member_count: number | string;
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
  const selectedLeague = params.league
    ? privateLeagues.find((league) => league.league_id === params.league) ?? null
    : null;
  const selectedResult = selectedLeague
    ? await supabase.rpc("get_private_league_leaderboard", {
        p_league_id: selectedLeague.league_id,
      })
    : globalResult;
  const leaderboard = (selectedResult.data ?? []) as LeaderboardRow[];
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
          <p className="mt-1 text-sm text-[var(--pf-text-muted)]">
            Compete globally or create a private leaderboard for your friends.
          </p>
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

        <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="table-panel h-fit rounded-lg border p-4">
            <h2 className="font-bold text-[var(--pf-text)]">Your leaderboards</h2>

            <nav aria-label="Leaderboard selection" className="mt-3 space-y-1.5">
              <Link
                aria-current={!selectedLeague ? "page" : undefined}
                className={`flex items-center justify-between rounded-md border px-3 py-2.5 text-sm font-semibold transition ${
                  !selectedLeague
                    ? "border-[var(--pf-brand-blue)] bg-[var(--pf-brand-blue-soft)] text-[var(--pf-text)]"
                    : "border-transparent text-[var(--pf-text-muted)] hover:border-[var(--pf-card-border)] hover:bg-[var(--pf-navy-elevated)] hover:text-[var(--pf-text)]"
                }`}
                href="/dashboard/leaderboard"
              >
                Global
              </Link>

              {privateLeagues.map((league) => (
                <Link
                  aria-current={
                    selectedLeague?.league_id === league.league_id
                      ? "page"
                      : undefined
                  }
                  className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition ${
                    selectedLeague?.league_id === league.league_id
                      ? "border-[var(--pf-brand-blue)] bg-[var(--pf-brand-blue-soft)] text-[var(--pf-text)]"
                      : "border-transparent text-[var(--pf-text-muted)] hover:border-[var(--pf-card-border)] hover:bg-[var(--pf-navy-elevated)] hover:text-[var(--pf-text)]"
                  }`}
                  href={privateLeaderboardHref(league.league_id)}
                  key={league.league_id}
                >
                  <span className="truncate">{league.league_name}</span>
                  <span className="shrink-0 text-xs font-normal">
                    {Number(league.member_count)}
                  </span>
                </Link>
              ))}
            </nav>

            {!privateMigrationMissing ? (
              <div className="mt-5 space-y-3 border-t border-[var(--pf-card-border)] pt-4">
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--pf-brand-blue)] hover:text-[var(--pf-brand-blue-hover)]">
                    Create private leaderboard
                  </summary>
                  <form action={createPrivateLeaderboard} className="mt-3 space-y-2">
                    <label className="block text-xs text-[var(--pf-text-muted)]">
                      Name
                      <input
                        className="mt-1.5 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-2.5 text-[var(--pf-text)] outline-none placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-brand-blue)]"
                        maxLength={50}
                        name="name"
                        placeholder="Friends league"
                        required
                      />
                    </label>
                    <button className="w-full rounded-md bg-[var(--pf-brand-blue)] px-3 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)]">
                      Create
                    </button>
                  </form>
                </details>

                <details open={Boolean(inviteCode)}>
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--pf-brand-blue)] hover:text-[var(--pf-brand-blue-hover)]">
                    Join with a code
                  </summary>
                  <form action={joinPrivateLeaderboard} className="mt-3 space-y-2">
                    <label className="block text-xs text-[var(--pf-text-muted)]">
                      Invitation code
                      <input
                        autoCapitalize="characters"
                        className="mt-1.5 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-2.5 font-mono uppercase tracking-[0.16em] text-[var(--pf-text)] outline-none placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-brand-blue)]"
                        defaultValue={inviteCode}
                        maxLength={8}
                        name="invite_code"
                        placeholder="AB12CD34"
                        required
                      />
                    </label>
                    <button className="w-full rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] px-3 py-2.5 text-sm font-bold text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)]">
                      Join
                    </button>
                  </form>
                </details>
              </div>
            ) : null}
          </aside>

          <section className="table-panel min-w-0 rounded-lg border p-4 sm:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
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
                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-2 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--pf-text-muted)]">
                      Invite code
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-bold tracking-[0.16em] text-[var(--pf-text)]">
                      {selectedLeague.invite_code}
                    </p>
                  </div>
                  <InviteControls inviteCode={selectedLeague.invite_code} />
                </div>
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

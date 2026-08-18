import Image from "next/image";
import { redirect } from "next/navigation";
import { getClubLogo } from "@/app/dashboard/club-logos";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import { FixtureResultsLink } from "@/app/fixture-results-link";
import { createClient } from "@/lib/supabase/server";

const STOCKHOLM_TIME_ZONE = "Europe/Stockholm";

type GameweekRow = {
  id: string;
  lock_at: string;
  name: string;
  round_order: number | null;
};

type FixtureRow = {
  id: string;
  fantasy_gameweek_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  starts_at: string | null;
};

type FixtureGroup = {
  startsAt: string | null;
  fixtures: FixtureRow[];
};

function formatDate(value: string | null) {
  if (!value) return "Date to be confirmed";

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: STOCKHOLM_TIME_ZONE,
    weekday: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value: string | null) {
  if (!value) return "Time TBC";

  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: STOCKHOLM_TIME_ZONE,
  }).format(new Date(value));
}

function formatTransferDeadline(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: STOCKHOLM_TIME_ZONE,
  }).format(new Date(value));
}

function groupFixturesByStart(fixtures: FixtureRow[]) {
  const groups = new Map<string, FixtureGroup>();

  for (const fixture of fixtures) {
    const key = fixture.starts_at ?? "unscheduled";
    const group = groups.get(key) ?? {
      startsAt: fixture.starts_at,
      fixtures: [],
    };

    group.fixtures.push(fixture);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function FixtureTeam({
  name,
  side,
}: {
  name: string | null;
  side: "away" | "home";
}) {
  const displayName = name ?? "TBC";
  const logo = name ? getClubLogo(name) : undefined;

  return (
    <span
      className={`flex min-w-0 items-center gap-1.5 sm:gap-2 ${
        side === "home" ? "justify-end" : "justify-start"
      }`}
    >
      {side === "away" && logo ? (
        <Image
          alt=""
          className="h-6 w-6 shrink-0 object-contain sm:h-7 sm:w-7"
          height={28}
          src={logo.src}
          width={28}
        />
      ) : null}
      <span
        className={`min-w-0 text-[11px] font-semibold leading-tight text-sky-50 min-[380px]:text-xs sm:text-sm ${
          side === "home" ? "text-right" : "text-left"
        }`}
      >
        {displayName}
      </span>
      {side === "home" && logo ? (
        <Image
          alt=""
          className="h-6 w-6 shrink-0 object-contain sm:h-7 sm:w-7"
          height={28}
          src={logo.src}
          width={28}
        />
      ) : null}
    </span>
  );
}

export default async function FixturesPage() {
  const supabase = await createClient();
  const [claimsResult, gameweeksResult, fixturesResult] = await Promise.all([
    supabase.auth.getClaims(),
    supabase
      .from("fantasy_gameweeks")
      .select("id, name, round_order, lock_at")
      .order("round_order", { ascending: true })
      .order("first_match_starts_at", { ascending: true }),
    supabase
      .from("matches")
      .select(
        "id, fantasy_gameweek_id, home_team_name, away_team_name, starts_at",
      )
      .order("starts_at", { ascending: true }),
  ]);

  if (!claimsResult.data?.claims.sub) {
    redirect("/login");
  }

  const gameweeks = (gameweeksResult.data ?? []) as GameweekRow[];
  const fixtures = (fixturesResult.data ?? []) as FixtureRow[];
  const fixtureError = gameweeksResult.error ?? fixturesResult.error;

  return (
    <main className="dashboard-shell table-tennis-surface min-h-screen text-white">
      <DashboardHeader />

      <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-5 sm:mb-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--pf-brand-blue-hover)]">
              Pingisligan 2026/27
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--pf-text)] sm:text-4xl">
              Fixtures
            </h1>
          </div>
        </div>

        <FixtureResultsLink className="mb-5 sm:mb-7" />

        {fixtureError ? (
          <div className="table-panel rounded-lg border p-5 text-sm text-amber-100">
            Fixtures could not be loaded. Check that the schedule migration has
            been applied in Supabase.
          </div>
        ) : null}

        {!fixtureError && !gameweeks.length ? (
          <div className="table-panel rounded-lg border p-6 text-center">
            <h2 className="text-xl font-black text-[var(--pf-text)]">
              No fixtures yet
            </h2>
            <p className="mt-2 text-sm text-[var(--pf-text-muted)]">
              Run the server-side schedule import to publish the season.
            </p>
          </div>
        ) : null}

        {!fixtureError && gameweeks.length ? (
          <div className="space-y-4 sm:space-y-5">
            {gameweeks.map((gameweek) => {
              const gameweekFixtures = fixtures.filter(
                (fixture) => fixture.fantasy_gameweek_id === gameweek.id,
              );
              const fixtureGroups = groupFixturesByStart(gameweekFixtures);

              return (
                <article
                  className="table-panel overflow-hidden rounded-lg border"
                  key={gameweek.id}
                >
                  <header className="flex items-start justify-between gap-3 border-b border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-4 py-3 sm:gap-6 sm:px-6 sm:py-4">
                    <h2 className="text-xl font-black text-[var(--pf-text)] sm:text-2xl">
                      Gameweek {gameweek.round_order ?? gameweek.name}
                    </h2>
                    <div className="shrink-0 text-right">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--pf-text-muted)] sm:text-[10px]">
                        Transfer deadline
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[var(--pf-text)] sm:text-xs">
                        {formatTransferDeadline(gameweek.lock_at)}
                      </p>
                    </div>
                  </header>

                  {fixtureGroups.length ? (
                    <div className="divide-y divide-[var(--pf-card-border)]">
                      {fixtureGroups.map((group) => (
                        <section
                          className="grid gap-3 px-4 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6 sm:px-6 sm:py-5"
                          key={group.startsAt ?? "unscheduled"}
                        >
                          <div>
                            <p className="text-sm font-bold text-[var(--pf-text)]">
                              {formatDate(group.startsAt)}
                            </p>
                            <p className="mt-0.5 text-base font-black tabular-nums text-[var(--pf-fantasy-yellow)]">
                              {formatTime(group.startsAt)}
                            </p>
                          </div>

                          <ul className="divide-y divide-white/10 rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-deep)]/55">
                            {group.fixtures.map((fixture) => (
                              <li
                                className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] items-center gap-1 px-2 py-2 sm:min-h-14 sm:gap-3 sm:px-4"
                                key={fixture.id}
                              >
                                <FixtureTeam
                                  name={fixture.home_team_name}
                                  side="home"
                                />
                                <span className="text-center text-xs font-black uppercase text-[var(--pf-brand-blue-hover)]">
                                  vs
                                </span>
                                <FixtureTeam
                                  name={fixture.away_team_name}
                                  side="away"
                                />
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <p className="px-4 py-5 text-sm text-[var(--pf-text-muted)] sm:px-6">
                      Match details are still to be confirmed.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}

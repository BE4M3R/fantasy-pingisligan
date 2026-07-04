import Image from "next/image";
import { redirect } from "next/navigation";
import {
  removePlayerFromTeam,
  setTeamCaptain,
  setPlayerPosition,
  updateTeamName,
} from "@/app/dashboard/actions";
import { DashboardHeader } from "@/app/dashboard/dashboard-header";
import { DeleteAccountForm } from "@/app/dashboard/delete-account-form";
import { SeasonBanner } from "@/app/season-banner";
import { getClubLogo } from "@/app/dashboard/club-logos";
import { PlayerPool, type DashboardPlayer } from "@/app/dashboard/player-pool";
import { createClient } from "@/lib/supabase/server";

const STARTER_SIZE = 4;
const BENCH_SIZE = 2;
const DEFAULT_BUDGET = 100000000;
const STUPA_RESULTS_URL =
  "https://sbtfeventsott.stupaevents.com/events/417/1118/0/1/1";
type SquadPosition = "starter" | "bench";

type FantasyTeam = {
  id: string;
  name: string;
  budget: number | string;
};

type SquadRow = {
  is_captain: boolean;
  player_id: string;
  position: SquadPosition;
  players: DashboardPlayer | DashboardPlayer[] | null;
};

type SquadPlayer = DashboardPlayer & {
  is_captain: boolean;
  position: SquadPosition;
};

type TransferLock = {
  is_locked: boolean;
  gameweek_name: string | null;
  lock_at: string | null;
  unlock_at: string | null;
};

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));
}

function getClubName(player: DashboardPlayer) {
  return Array.isArray(player.clubs)
    ? player.clubs[0]?.name
    : player.clubs?.name ?? "Free agent";
}

function getSquadPlayer(row: SquadRow) {
  const player = Array.isArray(row.players) ? row.players[0] : row.players;

  if (!player) {
    return null;
  }

  return {
    ...player,
    is_captain: row.is_captain,
    position: row.position,
  };
}

function ClubLogoBadge({ clubName, size = "md" }: { clubName: string; size?: "sm" | "md" }) {
  const logo = getClubLogo(clubName);
  const boxClass = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const imageClass = size === "sm" ? "max-h-7 max-w-7" : "max-h-9 max-w-9";

  return (
    <div
      className={`${boxClass} flex shrink-0 items-center justify-center rounded-md border border-white/10 bg-white p-1`}
    >
      {logo ? (
        <Image
          alt={logo.alt}
          className={`${imageClass} object-contain`}
          height={size === "sm" ? 28 : 36}
          src={logo.src}
          width={size === "sm" ? 28 : 36}
        />
      ) : (
        <span className="text-xs font-bold text-zinc-500">
          {clubName.slice(0, 1)}
        </span>
      )}
    </div>
  );
}

function SquadCard({
  player,
  transfersLocked,
}: {
  player: SquadPlayer;
  transfersLocked: boolean;
}) {
  const targetPosition = player.position === "starter" ? "bench" : "starter";

  return (
    <div className="rounded-md border border-white/15 bg-sky-950/70 p-4 shadow-sm shadow-slate-950/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ClubLogoBadge clubName={getClubName(player)} />
          <div className="min-w-0">
            <h3 className="truncate font-semibold">
              {player.first_name} {player.last_name}
              {player.is_captain ? (
                <span className="ml-2 rounded-sm bg-emerald-400 px-1.5 py-0.5 text-[10px] font-black uppercase text-zinc-950">
                  Captain
                </span>
              ) : null}
            </h3>
            <p className="mt-1 truncate text-sm text-sky-100/55">
              {getClubName(player)} · {formatMoney(player.price)}
            </p>
          </div>
        </div>
        <form action={removePlayerFromTeam}>
          <input name="player_id" type="hidden" value={player.id} />
          <button
            className="rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:border-red-300 hover:text-red-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-sky-100/35"
            disabled={transfersLocked}
          >
            Remove
          </button>
        </form>
      </div>

      <form action={setPlayerPosition} className="mt-4">
        <input name="player_id" type="hidden" value={player.id} />
        <input name="position" type="hidden" value={targetPosition} />
        <button
          className="w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:border-white/60 hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-sky-100/35"
          disabled={transfersLocked}
        >
          Move to {targetPosition === "starter" ? "main players" : "bench"}
        </button>
      </form>

      {!player.is_captain ? (
        <form action={setTeamCaptain} className="mt-2">
          <input name="player_id" type="hidden" value={player.id} />
          <button
            className="w-full rounded-md border border-sky-200/30 bg-sky-200/10 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:border-sky-100 hover:bg-sky-100/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-sky-100/35"
            disabled={transfersLocked}
          >
            Make captain
          </button>
        </form>
      ) : null}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const displayName =
    profile?.display_name ?? user.user_metadata.display_name ?? user.email;

  const { data: existingTeam } = await supabase
    .from("fantasy_teams")
    .select("id, name, budget")
    .eq("user_id", user.id)
    .maybeSingle();

  let fantasyTeam = existingTeam as FantasyTeam | null;

  if (!fantasyTeam) {
    const { data: createdTeam } = await supabase
      .from("fantasy_teams")
      .insert({
        user_id: user.id,
        name: "My team",
        budget: DEFAULT_BUDGET,
      })
      .select("id, name, budget")
      .single();

    fantasyTeam = createdTeam as FantasyTeam | null;
  }

  const { message } = await searchParams;

  const { data: playerRows } = await supabase
    .from("players")
    .select("id, first_name, last_name, birth_year, price, clubs(name)")
    .eq("active", true)
    .order("ranking_position", { ascending: true, nullsFirst: false })
    .order("price", { ascending: false });

  const { data: squadRows } = fantasyTeam
    ? await supabase
        .from("fantasy_team_players")
        .select(
          "player_id, position, is_captain, players(id, first_name, last_name, birth_year, price, clubs(name))",
        )
        .eq("fantasy_team_id", fantasyTeam.id)
    : { data: [] };

  const { data: transferLockRows } = await supabase.rpc("current_transfer_lock");

  const transferLock = (
    Array.isArray(transferLockRows) ? transferLockRows[0] : transferLockRows
  ) as TransferLock | null;
  const transfersLocked = Boolean(transferLock?.is_locked);
  const players = (playerRows ?? []) as DashboardPlayer[];
  const squad = ((squadRows ?? []) as SquadRow[])
    .map(getSquadPlayer)
    .filter((player): player is SquadPlayer => Boolean(player));
  const starters = squad.filter((player) => player.position === "starter");
  const bench = squad.filter((player) => player.position === "bench");
  const captain = squad.find((player) => player.is_captain);
  const selectedPlayerIds = squad.map((player) => player.id);
  const usedBudget = squad.reduce(
    (total, player) => total + Number(player.price),
    0,
  );
  const budget = Number(fantasyTeam?.budget ?? DEFAULT_BUDGET);
  const remainingBudget = budget - usedBudget;

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <DashboardHeader activeTab="squad" />

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6">
          <SeasonBanner />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="table-panel rounded-lg border p-6">
            <p className="text-sm font-medium text-sky-200">
              Welcome, {displayName}
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">
              {fantasyTeam?.name ?? "Your fantasy club"}
            </h1>
            <form
              action={updateTeamName}
              className="mt-5 flex max-w-xl flex-col gap-3 sm:flex-row"
            >
              <label className="sr-only" htmlFor="team_name">
                Team name
              </label>
              <input
                className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-sky-50 outline-none transition placeholder:text-sky-100/35 focus:border-sky-100/70 focus:bg-white/15"
                defaultValue={fantasyTeam?.name ?? ""}
                id="team_name"
                maxLength={40}
                name="team_name"
                placeholder="Team name"
                required
              />
              <button className="rounded-md bg-sky-100 px-4 py-2 text-sm font-bold text-sky-950 transition hover:bg-white">
                Save name
              </button>
            </form>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-sky-100/70">
              Select six players from the imported Pingisligan player pool and
              stay inside your fantasy budget.
            </p>
            <a
              className="mt-6 inline-flex rounded-md border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-sky-50 transition hover:border-white/60 hover:bg-white/10"
              href={STUPA_RESULTS_URL}
              rel="noreferrer"
              target="_blank"
            >
              Open Pingisligan results
            </a>
          </div>

          <div className="table-panel rounded-lg border p-6">
            <h2 className="text-base font-bold">Season status</h2>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-sky-100/55">Budget</dt>
                <dd className="mt-1 font-semibold text-sky-50">
                  {formatMoney(remainingBudget)}
                </dd>
              </div>
              <div>
                <dt className="text-sky-100/55">Main / bench</dt>
                <dd className="mt-1 font-semibold text-sky-50">
                  {starters.length} / {STARTER_SIZE} · {bench.length} /{" "}
                  {BENCH_SIZE}
                </dd>
              </div>
              <div>
                <dt className="text-sky-100/55">Squad value</dt>
                <dd className="mt-1 font-semibold text-sky-50">
                  {formatMoney(usedBudget)}
                </dd>
              </div>
              <div>
                <dt className="text-sky-100/55">Captain</dt>
                <dd className="mt-1 font-semibold text-sky-50">
                  {captain
                    ? `${captain.first_name} ${captain.last_name}`
                    : "Not selected"}
                </dd>
              </div>
            </dl>
            <DeleteAccountForm />
          </div>
        </div>

        {message ? (
          <div className="mt-6 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
            {message}
          </div>
        ) : null}

        {transfersLocked ? (
          <div className="mt-6 rounded-md border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {transferLock?.gameweek_name ?? "This gameweek"} is locked for
            squad changes until {formatDateTime(transferLock?.unlock_at ?? null)}.
          </div>
        ) : null}

        <section className="table-panel mt-8 rounded-lg border p-6">
          <div>
            <h2 className="text-base font-bold">My squad</h2>
            <p className="mt-1 text-sm text-sky-100/60">
              Pick four main players, two bench players, and one captain.
            </p>
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div>
              <div className="mb-3 flex items-center justify-between gap-4">
                <h3 className="text-sm font-bold text-sky-100">
                  Main players
                </h3>
                <span className="text-xs font-semibold text-sky-100/55">
                  {starters.length} / {STARTER_SIZE}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {starters.length ? (
                  starters.map((player) => (
                    <SquadCard
                      key={player.id}
                      player={player}
                      transfersLocked={transfersLocked}
                    />
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-white/20 px-4 py-8 text-sm text-sky-100/55 md:col-span-2">
                    No main players selected yet.
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-4">
                <h3 className="text-sm font-bold text-sky-100">Bench</h3>
                <span className="text-xs font-semibold text-sky-100/55">
                  {bench.length} / {BENCH_SIZE}
                </span>
              </div>
              <div className="grid gap-3">
                {bench.length ? (
                  bench.map((player) => (
                    <SquadCard
                      key={player.id}
                      player={player}
                      transfersLocked={transfersLocked}
                    />
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-white/20 px-4 py-8 text-sm text-sky-100/55">
                    No bench players selected yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="table-panel mt-8 rounded-lg border p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold">Player pool</h2>
              <p className="mt-1 text-sm text-sky-100/60">
                All active players currently available in Supabase.
              </p>
            </div>
          </div>

          <PlayerPool
            players={players}
            remainingBudget={remainingBudget}
            selectedPlayerIds={selectedPlayerIds}
            squadSize={squad.length}
            transfersLocked={transfersLocked}
          />
        </section>
      </section>
    </main>
  );
}

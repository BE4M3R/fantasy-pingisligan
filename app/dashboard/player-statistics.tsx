import Image from "next/image";
import { getClubLogo } from "@/app/dashboard/club-logos";
import { ClubLogo } from "@/app/dashboard/result-player-details";
import { StatisticsInfo } from "@/app/dashboard/statistics-info";
import { canonicalClubName } from "@/lib/clubs";
import { formatOwnership, gameweekLabel, hasPlayerAppearance, summarizePlayerWeeks, winRate } from "@/lib/player-statistics";
import type { PlayerStatistics } from "@/lib/player-statistics-data";

const panel = "relative rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-3 sm:p-4";
const formDescription = "Form is average points over the last five finished gameweeks (or fewer at season start). No recorded appearance counts as zero.";

function FixtureOpponent({ name }: { name: string }) {
  const club = canonicalClubName(name);
  const logo = getClubLogo(club);
  return <div className="flex min-w-0 flex-col items-center text-center">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[var(--pf-text)] p-1">
      {logo ? <Image alt={logo.alt} className="h-auto max-h-6 w-auto max-w-6 object-contain" height={24} width={24} src={logo.src} /> : <span aria-hidden="true" className="text-xs font-bold text-[var(--pf-navy)]">{club.slice(0, 1)}</span>}
    </span>
    <span className="mt-1 line-clamp-2 w-full break-words text-[10px] font-semibold leading-3 sm:text-xs sm:leading-4" title={club}>{club}</span>
  </div>;
}

export function PlayerStatisticsSummary({ player, includePoints = true, appearance = "accent", compact = false, compactOnShortScreens = false }: {
  player: PlayerStatistics["player"];
  includePoints?: boolean;
  appearance?: "accent" | "panel";
  compact?: boolean;
  compactOnShortScreens?: boolean;
}) {
  const metrics = [
    { label: "Price", value: `${(Number(player.price) / 1_000_000).toFixed(1)}m` },
    ...(includePoints ? [{ label: "Points", value: player.total_points }] : []),
    { label: "Form", value: player.form === null ? "—" : Number(player.form).toFixed(1) },
    { label: "Owned %", value: formatOwnership(player.owned_percent) },
  ];
  return <dl aria-label="Player summary" className={`grid ${includePoints ? "grid-cols-4" : "grid-cols-3"} gap-1.5 sm:gap-2`}>
      {metrics.map(({ label, value }) => <div className={`relative min-w-0 rounded-md border ${appearance === "panel" ? "border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)]" : "border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)]"} px-1.5 ${compact ? "py-1" : "py-2"} sm:px-3 ${compactOnShortScreens ? "[@media(max-height:640px)]:py-1" : ""}`} key={label}>
        <dt className={`${label === "Form" || label === "Owned %" ? "pr-3 " : ""}whitespace-nowrap text-[9px] leading-4 text-[var(--pf-text-muted)] min-[360px]:text-[10px] sm:text-xs ${compactOnShortScreens ? "[@media(max-height:640px)]:leading-3" : ""}`}>{label}</dt>
        <dd className={`font-black leading-tight tabular-nums ${compact ? "mt-0.5 text-sm sm:text-base" : "mt-1 text-base sm:text-xl"} ${compactOnShortScreens ? "[@media(max-height:640px)]:mt-0.5" : ""}`}>{value}</dd>
        {label === "Form" ? <StatisticsInfo label="Form">{formDescription}</StatisticsInfo> : null}
        {label === "Owned %" ? <StatisticsInfo label="Owned %">Percentage of teams that owned this player in the last finished gameweek.</StatisticsInfo> : null}
      </div>)}
    </dl>;
}

export function PlayerRecentForm({ history, compactOnShortScreens = false }: { history: PlayerStatistics["history"]; compactOnShortScreens?: boolean }) {
  const recent = history.slice(0, 5).toReversed();
  const maxPoints = Math.max(1, ...recent.map((week) => week.fantasy_points));
  return !history.length ? <div className={panel}>
      <h3 className="text-sm font-bold">No unlocked gameweeks yet</h3>
      <p className="mt-1 text-xs text-[var(--pf-text-muted)]">Statistics appear once a gameweek&apos;s results and scoring refresh completes and transfers reopen.</p>
    </div> : <section className={`relative rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-2 sm:px-4 ${compactOnShortScreens ? "[@media(max-height:640px)]:py-1" : ""}`} aria-label="Recent form">
      <h3 className="pr-5 text-sm font-bold">Recent form</h3>
      <StatisticsInfo label="Recent form">Shows points from the last 5 finished gameweeks</StatisticsInfo>
      <ul aria-label="Recent gameweek scores" className="mt-1 flex items-end gap-2">
        {recent.map((week) => {
          const played = hasPlayerAppearance(week);
          return <li className="min-w-0 flex-1 text-center" key={week.gameweek_id} aria-label={`${gameweekLabel(week)}: ${played ? `${week.fantasy_points} points, played` : "did not play"}`}>
            <div className="flex h-8 flex-col justify-end">
              <span className="mb-0.5 text-[11px] font-bold leading-3 tabular-nums">{played ? week.fantasy_points : "-"}</span>
              <div aria-hidden="true" className={`mx-auto w-full max-w-14 rounded-t ${played ? "bg-[var(--pf-brand-blue)]" : ""}`} style={{ height: `${played ? Math.max(2, 16 * week.fantasy_points / maxPoints) : 2}px` }} />
            </div>
            <p className="mt-0.5 break-words text-[10px] text-[var(--pf-text-muted)]">{gameweekLabel(week)}</p>
          </li>;
        })}
      </ul>
    </section>;
}

export function PlayerUpcomingMatches({ player, fixtures, compactOnShortScreens = false }: Pick<PlayerStatistics, "player" | "fixtures"> & { compactOnShortScreens?: boolean }) {
  const club = Array.isArray(player.clubs) ? player.clubs[0] : player.clubs;
  return <section className={`${panel} ${compactOnShortScreens ? "[@media(max-height:640px)]:py-1" : ""}`}>
      <h3 className="pr-5 text-sm font-bold">Upcoming matches</h3>
      <StatisticsInfo label="Home and away">H (home) and A (away)</StatisticsInfo>
      {fixtures.length ? <ul aria-label="Upcoming opponents" className="mt-2 grid grid-cols-3 gap-2">
        {fixtures.map((fixture) => {
          const home = fixture.home_club_id === club?.id;
          const opponent = home ? fixture.away_club?.name ?? fixture.away_team_name : fixture.home_club?.name ?? fixture.home_team_name;
          const date = fixture.starts_at ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" }).format(new Date(fixture.starts_at)) : "Date TBC";
          const gameweek = fixture.gameweek?.round_order != null ? `GW${fixture.gameweek.round_order}` : fixture.gameweek?.name ?? "GW —";
          return <li className="min-w-0 text-center" key={fixture.id} aria-label={`${canonicalClubName(opponent ?? "TBC")} · ${gameweek} · ${home ? "Home" : "Away"} · ${date} Stockholm`} title={`${home ? "Home" : "Away"} · ${date} Stockholm`}>
            <FixtureOpponent name={opponent ?? "TBC"} />
            <p className="mt-0.5 text-[10px] leading-3 text-[var(--pf-text-muted)]">{gameweek} ({home ? "H" : "A"})</p>
          </li>;
        })}
      </ul> : <p className="mt-2 text-xs text-[var(--pf-text-muted)]">No upcoming fixtures scheduled.</p>}
    </section>;
}

export function PlayerStatisticsHighlights({ statistics }: { statistics: PlayerStatistics }) {
  return <div className="space-y-3 [@media(max-height:640px)]:space-y-2">
    <PlayerStatisticsSummary player={statistics.player} includePoints={false} appearance="panel" compact />
    <PlayerRecentForm history={statistics.history} compactOnShortScreens />
    <PlayerUpcomingMatches player={statistics.player} fixtures={statistics.fixtures} compactOnShortScreens />
  </div>;
}

export function PlayerStatisticsContent({ statistics }: { statistics: PlayerStatistics }) {
  const { player, history, fixtures } = statistics;
  const totals = summarizePlayerWeeks(history);
  const club = Array.isArray(player.clubs) ? player.clubs[0] : player.clubs;

  return <div className="space-y-3">
    <div className="flex items-center gap-3 pr-12">
      <ClubLogo player={player} />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--pf-brand-blue-hover)]">Player statistics</p>
        <h2 className="mt-0.5 break-words text-xl font-black leading-tight sm:text-2xl">{player.first_name} {player.last_name}</h2>
        <p className="mt-1 text-xs text-[var(--pf-text-muted)]">{canonicalClubName(club?.name ?? "Free agent")}{player.birth_year ? ` · Born ${player.birth_year}` : ""}</p>
        {!player.active ? <p className="mt-1 text-xs text-[var(--pf-coral-text)]">Unavailable for new transfers</p> : null}
      </div>
    </div>

    <PlayerStatisticsSummary player={player} />
    <PlayerRecentForm history={history} />

    <div className="grid grid-cols-2 gap-2">
      {[
        { label: "Singles", wins: totals.singlesWins, losses: totals.singlesLosses },
        { label: "Doubles", wins: totals.doublesWins, losses: totals.doublesLosses },
      ].map(({ label, wins, losses }) => {
        const rate = winRate(wins, losses);
        return <section className="relative rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-2.5 sm:p-3" key={label}>
          <h3 className="text-xs font-bold sm:text-sm">{label}</h3>
          <dl className="mt-2 grid grid-cols-3 gap-1">
            <div><dt className="text-[10px] text-[var(--pf-text-muted)]">Won</dt><dd className="mt-0.5 text-base font-bold tabular-nums sm:text-lg">{wins}</dd></div>
            <div><dt className="text-[10px] text-[var(--pf-text-muted)]">Lost</dt><dd className="mt-0.5 text-base font-bold tabular-nums sm:text-lg">{losses}</dd></div>
            <div><dt className="text-[10px] text-[var(--pf-text-muted)]">Win %</dt><dd className="mt-0.5 text-base font-bold tabular-nums sm:text-lg">{rate === null ? "—" : `${rate}%`}</dd></div>
          </dl>
          {label === "Singles" ? <dl className="mt-2 space-y-1 border-t border-[var(--pf-card-border)] pt-1.5 text-[10px] text-[var(--pf-text-muted)]">
            <div className="flex flex-wrap justify-between gap-x-1"><dt>Sets won match</dt><dd className="whitespace-nowrap tabular-nums"><strong className="text-[var(--pf-text)]">{totals.wonMatchSetsWon}–{totals.wonMatchSetsLost}</strong> · {totals.wonMatchSetPoints} pts</dd></div>
            <div className="flex flex-wrap justify-between gap-x-1"><dt>Sets lost match</dt><dd className="whitespace-nowrap tabular-nums"><strong className="text-[var(--pf-text)]">{totals.lostMatchSetsWon}–{totals.lostMatchSetsLost}</strong> · {totals.lostMatchSetPoints} pts</dd></div>
          </dl> : null}
        </section>;
      })}
    </div>

    <PlayerUpcomingMatches player={player} fixtures={fixtures} />

    {history.length ? <section className="relative overflow-hidden rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)]">
      <h3 className="px-3 pb-2 pt-3 text-sm font-bold">Gameweek history</h3>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Player gameweek history">
        <table className="w-full text-left text-[11px] sm:text-xs">
          <thead className="bg-[var(--pf-navy-deep)] text-[var(--pf-text-muted)]"><tr>
            {["GW", "Singles", "Doubles", "Sets", "Pts"].map((label) => <th className="whitespace-nowrap px-2 py-2 font-medium first:pl-3 last:text-right sm:px-3" scope="col" key={label}>{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-[var(--pf-card-border)]">{history.map((week) => <tr key={week.gameweek_id}>
            <th className="px-2 py-2 pl-3 font-semibold" scope="row">{gameweekLabel(week)}</th>
            <td className="whitespace-nowrap px-2 py-2 tabular-nums sm:px-3">{week.singles_wins}–{week.singles_losses}</td>
            <td className="whitespace-nowrap px-2 py-2 tabular-nums sm:px-3">{week.doubles_wins}–{week.doubles_losses}</td>
            <td className="whitespace-nowrap px-2 py-2 tabular-nums sm:px-3">{week.singles_sets_won}–{week.singles_sets_lost}</td>
            <td className="px-2 py-2 text-right font-bold tabular-nums sm:px-3">{week.fantasy_points}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section> : null}
  </div>;
}

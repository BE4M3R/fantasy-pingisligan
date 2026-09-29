"use client";

import Image from "next/image";
import { canonicalClubName } from "@/lib/clubs";
import { getClubLogo } from "@/app/dashboard/club-logos";
import type { DashboardPlayer, SquadPlayerResult } from "@/app/dashboard/player-types";
import { splitSinglesSetPoints } from "@/app/dashboard/player-types";

export type ResultBreakdownData = Pick<SquadPlayerResult,
  "active_chip" | "captain_bonus_points" | "clinching_bonus_points" | "counts_for_team" |
  "doubles_losses" | "doubles_wins" | "fantasy_points" | "fixture_win_points" |
  "is_captain" | "original_position" | "position" | "set_breakdown_available" |
  "set_points" | "sets_lost" | "sets_won" | "singles_losses" | "singles_set_points" |
  "singles_sets_lost" | "singles_sets_won" | "singles_wins" | "sweep_bonus_points" |
  "team_points_contribution"
>;

function formatPoints(value: number) {
  return `${value > 0 ? "+" : ""}${value} pts`;
}

function formatSetScore(setsWon: number, setsLost: number) {
  return `${setsWon} ${setsWon === 1 ? "set" : "sets"} won, ${setsLost} ${setsLost === 1 ? "set" : "sets"} lost`;
}

export function getBreakdownDisplayPoints(result: ResultBreakdownData) {
  return result.original_position === "bench" && !result.counts_for_team
    ? result.fantasy_points
    : result.team_points_contribution;
}

export function ClubLogo({ player }: { player: DashboardPlayer }) {
  const name = Array.isArray(player.clubs) ? player.clubs[0]?.name : player.clubs?.name;
  const clubName = canonicalClubName(name ?? "Free agent");
  const logo = getClubLogo(clubName);

  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[var(--pf-text)] p-1.5">
      {logo ? (
        <Image alt={logo.alt} className="h-auto w-auto max-h-12 max-w-12 object-contain" height={48} src={logo.src} width={48} />
      ) : (
        <span className="text-base font-black text-[var(--pf-navy)]">{clubName.slice(0, 1)}</span>
      )}
    </div>
  );
}

export function ResultBreakdown({ result }: { result: ResultBreakdownData }) {
  const playedMatch = result.singles_wins + result.singles_losses + result.doubles_wins + result.doubles_losses > 0;
  const displayedPoints = getBreakdownDisplayPoints(result);
  const singlesSetPoints = result.set_breakdown_available
    ? splitSinglesSetPoints(result)
    : null;
  const rows: {
    detail: string;
    label: string;
    points: number;
    show: boolean;
  }[] = [
    {
      detail: `${result.singles_wins} won, ${result.singles_losses} lost`,
      label: "Singles won",
      points: result.singles_wins * 4,
      show: result.singles_wins + result.singles_losses > 0,
    },
    {
      detail: `${result.doubles_wins} won, ${result.doubles_losses} lost`,
      label: "Doubles won",
      points: result.doubles_wins * 2,
      show: result.doubles_wins + result.doubles_losses > 0,
    },
    ...(singlesSetPoints
      ? [
          {
            detail: formatSetScore(singlesSetPoints.wonSetsInWins, singlesSetPoints.lostSetsInWins),
            label: "Won singles set-score",
            points: singlesSetPoints.wonPoints,
            show: result.singles_wins > 0,
          },
          {
            detail: formatSetScore(singlesSetPoints.wonSetsInLosses, singlesSetPoints.lostSetsInLosses),
            label: "Lost singles set-score",
            points: singlesSetPoints.lostPoints,
            show: result.singles_losses > 0,
          },
        ]
      : [
          {
            detail: result.set_breakdown_available
              ? `${result.singles_sets_won} sets won, ${result.singles_sets_lost} lost`
              : `${result.sets_won} won, ${result.sets_lost} lost`,
            label: result.set_breakdown_available ? "Singles set-score" : "Set-score points",
            points: result.set_breakdown_available ? result.singles_set_points : result.set_points,
            show: result.set_breakdown_available
              ? result.singles_sets_won + result.singles_sets_lost > 0
              : result.sets_won + result.sets_lost > 0,
          },
        ]),
    {
      detail: `${result.fixture_win_points / 3} ${result.fixture_win_points === 3 ? "fixture" : "fixtures"} won`,
      label: "Fixtures won",
      points: result.fixture_win_points,
      show: result.fixture_win_points !== 0,
    },
    {
      detail: "Sealed your club's fixture win",
      label: "Fixture clincher bonus",
      points: result.clinching_bonus_points,
      show: result.clinching_bonus_points !== 0,
    },
    {
      detail: "Won every singles match (minimum two)",
      label: "Singles sweep bonus",
      points: result.sweep_bonus_points,
      show: result.sweep_bonus_points !== 0,
    },
  ].filter((row) => row.show);

  return (
    <div className="mt-5">
      <div className="rounded-lg bg-[var(--pf-navy-elevated)] p-3">
        <p className="text-[0.65rem] font-bold uppercase tracking-wide text-[var(--pf-text-muted)]">Total points</p>
        <p className="mt-1 text-2xl font-black text-[var(--pf-fantasy-yellow)]">{displayedPoints}</p>
        {displayedPoints === 0 ? (
          <p className="mt-1 text-xs font-bold text-[var(--pf-text-muted)]">
            {playedMatch ? "Played this gameweek" : "Did not play this gameweek"}
          </p>
        ) : null}
      </div>

      <h3 className="mt-5 text-xs font-black uppercase tracking-[0.14em] text-[var(--pf-brand-blue-hover)]">Points breakdown</h3>
      {rows.length ? (
        <dl className="mt-2 divide-y divide-[var(--pf-card-border)] rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3">
          {rows.map((row) => (
            <div className="flex items-center justify-between gap-4 py-3" key={row.label}>
              <div className="min-w-0">
                <dt className="text-sm font-bold text-[var(--pf-text)]">{row.label}</dt>
                <dd className="mt-0.5 text-xs text-[var(--pf-text-muted)]">{row.detail}</dd>
              </div>
              <dd className={`shrink-0 text-sm font-black ${row.points < 0 ? "text-[var(--pf-coral-text)]" : "text-[var(--pf-text)]"}`}>
                {formatPoints(row.points)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-3 text-sm text-[var(--pf-text-muted)]">
          {playedMatch ? "Played, but earned no scoring points." : "Did not play this gameweek."}
        </p>
      )}

      {result.is_captain ? (
        <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-[var(--pf-fantasy-yellow)]/45 bg-[var(--pf-navy-elevated)] p-3">
          <div>
            <p className="text-sm font-bold text-[var(--pf-fantasy-yellow)]">
              {result.active_chip === "triple_captain" ? "Triple Captain" : "Captain"}
            </p>
            <p className="mt-0.5 text-xs text-[var(--pf-text-muted)]">
              {result.active_chip === "triple_captain" ? "Player points counted three times" : "Player points counted twice"}
            </p>
          </div>
          <p className="shrink-0 text-sm font-black text-[var(--pf-fantasy-yellow)]">{formatPoints(result.captain_bonus_points)}</p>
        </div>
      ) : null}

      {result.position === "bench" ? (
        <div className="mt-3 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] p-3">
          <p className="text-sm font-bold text-[var(--pf-text)]">
            {result.active_chip === "bench_boost" ? "Bench Boost active" : "Bench points not counted"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--pf-text-muted)]">
            {result.active_chip === "bench_boost"
              ? `${result.fantasy_points} bench points included in the team total.`
              : `${result.fantasy_points} player points earned, with no Bench Boost active.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}

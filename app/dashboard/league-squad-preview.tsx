"use client";

import { useRef, useState } from "react";
import { ClubLogo, ResultBreakdown, type ResultBreakdownData } from "@/app/dashboard/result-player-details";
import { SquadCardVisual, squadCardShellClass } from "@/app/dashboard/squad-card-visual";
import { SquadLineupView } from "@/app/dashboard/squad-lineup-view";
import type { DraftSquadPlayer } from "@/app/dashboard/player-types";
import { createClient } from "@/lib/supabase/browser";

export type LeagueSnapshotPlayer = {
  player_id: string;
  first_name: string;
  last_name: string;
  club_name: string | null;
  position: "starter" | "bench";
  is_captain: boolean;
  lineup_order: number;
  fantasy_points: number;
  has_played: boolean;
  active_chip: "wildcard" | "triple_captain" | "bench_boost" | null;
  transfer_penalty_points: number;
};

type DisplayPlayer = LeagueSnapshotPlayer & {
  effectiveCaptain: boolean;
  substitution: "in" | "out" | null;
};

type PlayerScoreBreakdown = Pick<ResultBreakdownData,
  "singles_wins" | "singles_losses" | "doubles_wins" | "doubles_losses" |
  "singles_sets_won" | "singles_sets_lost" | "singles_set_points" |
  "fixture_win_points" | "clinching_bonus_points" | "sweep_bonus_points"
>;

function getDisplayLineup(players: LeagueSnapshotPlayer[]) {
  const ordered = [...players].sort((a, b) => a.lineup_order - b.lineup_order);
  const starters = ordered.filter((player) => player.position === "starter");
  const bench = ordered.filter((player) => player.position === "bench");
  const displayedStarters: DisplayPlayer[] = starters.map((player) => ({
    ...player,
    effectiveCaptain: player.is_captain,
    substitution: null,
  }));
  const displayedBench: DisplayPlayer[] = bench.map((player) => ({
    ...player,
    effectiveCaptain: false,
    substitution: null,
  }));
  const missing = starters.flatMap((player, index) => player.has_played ? [] : [index]);
  const playingBench = bench.flatMap((player, index) => player.has_played ? [index] : []);

  for (let index = 0; index < Math.min(missing.length, playingBench.length); index += 1) {
    const starterIndex = missing[index];
    const benchIndex = playingBench[index];
    displayedStarters[starterIndex] = {
      ...bench[benchIndex],
      effectiveCaptain: starters[starterIndex].is_captain,
      substitution: "in",
    };
    displayedBench[benchIndex] = {
      ...starters[starterIndex],
      effectiveCaptain: false,
      substitution: "out",
    };
  }

  return { starters: displayedStarters, bench: displayedBench };
}

function toDraft(player: DisplayPlayer, onBench: boolean): DraftSquadPlayer {
  return {
    id: player.player_id,
    first_name: player.first_name,
    last_name: player.last_name,
    birth_year: null,
    price: 0,
    clubs: player.club_name ? { id: "", name: player.club_name } : null,
    position: onBench ? "bench" : "starter",
    is_captain: player.effectiveCaptain,
  };
}

function SnapshotCard({ player, onBench, onSelect }: {
  player: DisplayPlayer;
  onBench: boolean;
  onSelect: (trigger: HTMLButtonElement) => void;
}) {
  const draft = toDraft(player, onBench);
  const multiplier = player.effectiveCaptain
    ? player.active_chip === "triple_captain" ? 3 : 2
    : 1;
  const points = onBench && player.active_chip !== "bench_boost"
    ? player.fantasy_points
    : player.has_played ? player.fantasy_points * multiplier : 0;

  return (
    <button
      aria-label={`Open result details for ${player.first_name} ${player.last_name}`}
      className={`${squadCardShellClass(draft)} touch-manipulation cursor-pointer transition hover:-translate-y-0.5 hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-navy-elevated)] active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-table-blue)]`}
      onClick={(event) => onSelect(event.currentTarget)}
      type="button"
    >
      <div className="flex min-w-0 flex-col items-center">
        <SquadCardVisual
          player={draft}
          resultPoints={points}
          automaticSubstitution={player.substitution}
        />
        <span aria-hidden="true" className="absolute right-2 top-1 text-base leading-none tracking-[-0.16em] text-[var(--pf-text-muted)]/55">•••</span>
      </div>
    </button>
  );
}

export function LeagueSquadPreview({ players, userId, gameweekId, gameweekLabel }: {
  players: LeagueSnapshotPlayer[];
  userId: string;
  gameweekId: string;
  gameweekLabel: string;
}) {
  const lineup = getDisplayLineup(players);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const breakdownCache = useRef(new Map<string, PlayerScoreBreakdown>());
  const [selected, setSelected] = useState<{ player: DisplayPlayer; onBench: boolean } | null>(null);
  const [breakdown, setBreakdown] = useState<PlayerScoreBreakdown | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function openDetails(player: DisplayPlayer, onBench: boolean, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setSelected({ player, onBench });
    setError(false);
    const cached = breakdownCache.current.get(player.player_id);
    setBreakdown(cached ?? null);
    setLoading(!cached);
    dialogRef.current?.showModal();
    if (cached) return;

    const { data, error: loadError } = await createClient().rpc(
      "get_league_player_score_breakdown",
      { p_user_id: userId, p_gameweek_id: gameweekId, p_player_id: player.player_id },
    );
    if (!dialogRef.current?.open) return;
    if (loadError || !data?.[0]) {
      setError(true);
    } else {
      const score = data[0] as PlayerScoreBreakdown;
      breakdownCache.current.set(player.player_id, score);
      setBreakdown(score);
    }
    setLoading(false);
  }

  const player = selected?.player;
  const multiplier = player?.effectiveCaptain
    ? player.active_chip === "triple_captain" ? 3 : 2
    : 1;
  const countsForTeam = Boolean(player && (player.active_chip === "bench_boost" || (!selected?.onBench && player.has_played)));
  const details: ResultBreakdownData | null = player && breakdown ? {
    ...breakdown,
    active_chip: player.active_chip,
    captain_bonus_points: countsForTeam ? player.fantasy_points * (multiplier - 1) : 0,
    counts_for_team: countsForTeam,
    fantasy_points: player.fantasy_points,
    is_captain: player.effectiveCaptain,
    original_position: player.position,
    position: selected.onBench ? "bench" : "starter",
    set_breakdown_available: true,
    set_points: breakdown.singles_set_points,
    sets_lost: breakdown.singles_sets_lost,
    sets_won: breakdown.singles_sets_won,
    team_points_contribution: countsForTeam ? player.fantasy_points * multiplier : 0,
  } : null;

  return (
    <>
      <SquadLineupView
        className="mt-4"
        idPrefix="league"
        title="Active players"
        compactTitle
        starterCount={lineup.starters.length}
        benchCount={lineup.bench.length}
        renderStarter={(index) => lineup.starters[index]
          ? <SnapshotCard player={lineup.starters[index]} onBench={false} onSelect={(trigger) => void openDetails(lineup.starters[index], false, trigger)} />
          : null}
        renderBench={(index) => lineup.bench[index]
          ? <SnapshotCard player={lineup.bench[index]} onBench onSelect={(trigger) => void openDetails(lineup.bench[index], true, trigger)} />
          : null}
      />
      <dialog
        aria-labelledby="league-player-details-title"
        className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-5 text-[var(--pf-text)] shadow-2xl backdrop:bg-[var(--pf-navy-deep)]/80 sm:p-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
        onClose={() => {
          setSelected(null);
          triggerRef.current?.focus();
        }}
        ref={dialogRef}
      >
        {player ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <ClubLogo player={toDraft(player, selected.onBench)} />
                <div className="min-w-0">
                  <h2 className="text-xl font-bold leading-tight" id="league-player-details-title">
                    {player.first_name} {player.last_name}
                  </h2>
                  <p className="mt-1 text-sm font-bold text-[var(--pf-text-muted)]">
                    {gameweekLabel} · {selected.onBench && !countsForTeam ? player.fantasy_points : player.fantasy_points * multiplier} pts
                  </p>
                </div>
              </div>
              <button
                aria-label="Close player details"
                autoFocus
                className="touch-manipulation rounded-md px-3 py-1 text-2xl text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                onClick={() => dialogRef.current?.close()}
                type="button"
              >×</button>
            </div>
            {loading ? <p className="mt-5 text-sm text-[var(--pf-text-muted)]">Loading points breakdown…</p> : null}
            {error ? <p className="mt-5 text-sm text-[var(--pf-coral-text)]">Points breakdown could not be loaded. Please try again.</p> : null}
            {details ? <ResultBreakdown result={details} /> : null}
          </>
        ) : null}
      </dialog>
    </>
  );
}

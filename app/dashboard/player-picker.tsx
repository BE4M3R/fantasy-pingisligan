"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { addPlayerToTeam, swapPlayerIntoTeam } from "@/app/dashboard/actions";
import { getClubLogo } from "@/app/dashboard/club-logos";
import type { DashboardPlayer, SquadPosition } from "@/app/dashboard/player-types";

type PlayerPickerProps = {
  position: SquadPosition;
  remainingBudget: number;
  selectedPlayerIds: string[];
  transfersLocked: boolean;
  outgoingPlayerId?: string;
  trigger?: "slot" | "replace";
};

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
}

function getClubName(player: DashboardPlayer) {
  return Array.isArray(player.clubs)
    ? player.clubs[0]?.name
    : player.clubs?.name ?? "Free agent";
}

function ClubLogo({ player }: { player: DashboardPlayer }) {
  const clubName = getClubName(player);
  const logo = getClubLogo(clubName);

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white p-1">
      {logo ? (
        <Image alt={logo.alt} className="max-h-8 max-w-8 object-contain" height={32} src={logo.src} width={32} />
      ) : (
        <span className="text-xs font-bold text-zinc-500">{clubName.slice(0, 1)}</span>
      )}
    </div>
  );
}

export function PlayerPicker({
  position,
  remainingBudget,
  selectedPlayerIds,
  transfersLocked,
  outgoingPlayerId,
  trigger = "slot",
}: PlayerPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [players, setPlayers] = useState<DashboardPlayer[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [club, setClub] = useState("all");

  async function openPicker() {
    dialogRef.current?.showModal();

    if (players) return;

    setError("");
    try {
      const response = await fetch("/api/players");
      const payload = (await response.json()) as { players?: DashboardPlayer[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load players.");
      setPlayers(payload.players ?? []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Could not load players.");
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const closeOnBackdrop = (event: MouseEvent) => {
      if (event.target === dialog) dialog.close();
    };
    dialog.addEventListener("click", closeOnBackdrop);
    return () => dialog.removeEventListener("click", closeOnBackdrop);
  }, []);

  const selectedIds = useMemo(() => new Set(selectedPlayerIds), [selectedPlayerIds]);
  const clubs = useMemo(
    () => [...new Set((players ?? []).map(getClubName))].sort((a, b) => a.localeCompare(b, "sv-SE")),
    [players],
  );
  const visiblePlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("sv-SE");
    return (players ?? []).filter((player) => {
      const matchesQuery = `${player.first_name} ${player.last_name} ${getClubName(player)}`
        .toLocaleLowerCase("sv-SE")
        .includes(normalizedQuery);
      return matchesQuery && (club === "all" || getClubName(player) === club);
    });
  }, [club, players, query]);

  const slotLabel = position === "starter" ? "main player" : "bench player";
  const isReplacement = Boolean(outgoingPlayerId);

  return (
    <>
      <button
        className={trigger === "replace"
          ? "mt-2 w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:border-white/60 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          : "group flex min-h-28 w-full flex-col items-center justify-center rounded-md border border-dashed border-sky-200/35 bg-sky-950/35 px-4 py-6 text-sky-100/70 transition hover:border-sky-100 hover:bg-sky-900/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"}
        disabled={transfersLocked}
        onClick={openPicker}
        type="button"
      >
        {trigger === "slot" ? <span className="flex h-10 w-10 items-center justify-center rounded-full border border-current text-2xl leading-none transition group-hover:scale-105">+</span> : null}
        <span className={trigger === "slot" ? "mt-3 text-sm font-semibold" : ""}>{isReplacement ? "Replace player" : `Add ${slotLabel}`}</span>
      </button>

      <dialog
        aria-labelledby={`player-picker-title-${position}`}
        className="m-auto h-[100dvh] max-h-none w-full max-w-none bg-transparent p-0 text-white backdrop:bg-slate-950/75 sm:h-auto sm:max-h-[85dvh] sm:w-[min(56rem,calc(100%-2rem))] sm:rounded-xl"
        ref={dialogRef}
      >
        <div className="flex h-full max-h-[100dvh] flex-col border border-white/15 bg-sky-950 shadow-2xl sm:max-h-[85dvh] sm:rounded-xl">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5 sm:p-6">
            <div>
              <h2 className="text-xl font-bold" id={`player-picker-title-${position}`}>{isReplacement ? "Replace player" : `Add ${slotLabel}`}</h2>
              <p className="mt-1 text-sm text-sky-100/60">Remaining budget: {formatMoney(remainingBudget)}</p>
            </div>
            <button aria-label="Close player picker" className="rounded-md px-3 py-1 text-2xl text-sky-100/60 hover:bg-white/10 hover:text-white" onClick={() => dialogRef.current?.close()} type="button">×</button>
          </div>

          <div className="grid gap-3 border-b border-white/10 p-5 sm:grid-cols-[1fr_14rem] sm:p-6">
            <input aria-label="Search players" className="rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-sky-100/40 focus:border-sky-100" onChange={(event) => setQuery(event.target.value)} placeholder="Search player or club…" value={query} />
            <select aria-label="Filter by club" className="rounded-md border border-white/15 bg-sky-950 px-3 py-2 text-sm outline-none focus:border-sky-100" onChange={(event) => setClub(event.target.value)} value={club}>
              <option value="all">All clubs</option>
              {clubs.map((clubName) => <option key={clubName} value={clubName}>{clubName}</option>)}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {!players && !error ? <p className="py-12 text-center text-sm text-sky-100/60">Loading players…</p> : null}
            {error ? <div className="rounded-md border border-red-300/30 bg-red-400/10 p-4 text-sm text-red-100">{error}</div> : null}
            {players ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {visiblePlayers.map((player) => {
                  const selected = selectedIds.has(player.id);
                  const tooExpensive = Number(player.price) > remainingBudget;
                  return (
                    <div className="flex items-center gap-3 rounded-md border border-white/15 bg-white/5 p-3" key={player.id}>
                      <ClubLogo player={player} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{player.first_name} {player.last_name}</p>
                        <p className="mt-1 truncate text-xs text-sky-100/55">{getClubName(player)} · {formatMoney(player.price)}</p>
                      </div>
                      <form action={isReplacement ? swapPlayerIntoTeam : addPlayerToTeam}>
                        <input name="player_id" type="hidden" value={player.id} />
                        <input name="position" type="hidden" value={position} />
                        {outgoingPlayerId ? <input name="outgoing_player_id" type="hidden" value={outgoingPlayerId} /> : null}
                        <button className="rounded-md bg-sky-100 px-3 py-2 text-xs font-bold text-sky-950 hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" disabled={selected || tooExpensive || transfersLocked}>
                          {selected ? "Selected" : tooExpensive ? "Over budget" : "Add"}
                        </button>
                      </form>
                    </div>
                  );
                })}
                {!visiblePlayers.length ? <p className="py-10 text-center text-sm text-sky-100/60 sm:col-span-2">No players match your filters.</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}

"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { getClubLogo } from "@/app/dashboard/club-logos";
import type { DashboardPlayer, SquadPosition } from "@/app/dashboard/player-types";

type PlayerPickerProps = {
  onSelect: (player: DashboardPlayer) => void;
  position: SquadPosition;
  remainingBudget: number;
  selectedClubIds: string[];
  selectedPlayerIds: string[];
  transfersLocked: boolean;
  outgoingClubId?: string;
  outgoingPlayerId?: string;
  trigger?: "slot" | "replace";
};

type PriceSort = "default" | "low-to-high" | "high-to-low";
const MAX_PLAYERS_PER_CLUB = 2;

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
}

function getClubName(player: DashboardPlayer) {
  return Array.isArray(player.clubs)
    ? player.clubs[0]?.name
    : player.clubs?.name ?? "Free agent";
}

function getClubId(player: DashboardPlayer) {
  return Array.isArray(player.clubs)
    ? player.clubs[0]?.id ?? null
    : player.clubs?.id ?? null;
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
  onSelect,
  position,
  remainingBudget,
  selectedClubIds,
  selectedPlayerIds,
  transfersLocked,
  outgoingClubId,
  outgoingPlayerId,
  trigger = "slot",
}: PlayerPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [players, setPlayers] = useState<DashboardPlayer[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [club, setClub] = useState("all");
  const [priceSort, setPriceSort] = useState<PriceSort>("default");
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function openPicker() {
    setFiltersOpen(false);
    dialogRef.current?.showModal();
    setPickerOpen(true);

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
    const handleClose = () => setPickerOpen(false);
    dialog.addEventListener("click", closeOnBackdrop);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("click", closeOnBackdrop);
      dialog.removeEventListener("close", handleClose);
    };
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;

    const body = document.body;
    const scrollPosition = window.scrollY;
    const previousStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollPosition}px`;
    body.style.width = "100%";

    return () => {
      body.style.overflow = previousStyles.overflow;
      body.style.position = previousStyles.position;
      body.style.top = previousStyles.top;
      body.style.width = previousStyles.width;
      window.scrollTo(0, scrollPosition);
    };
  }, [pickerOpen]);

  const selectedIds = useMemo(() => new Set(selectedPlayerIds), [selectedPlayerIds]);
  const clubCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const clubId of selectedClubIds) {
      counts.set(clubId, (counts.get(clubId) ?? 0) + 1);
    }

    if (outgoingClubId) {
      counts.set(outgoingClubId, Math.max(0, (counts.get(outgoingClubId) ?? 0) - 1));
    }

    return counts;
  }, [outgoingClubId, selectedClubIds]);
  const clubs = useMemo(
    () => [...new Set((players ?? []).map(getClubName))].sort((a, b) => a.localeCompare(b, "sv-SE")),
    [players],
  );
  const visiblePlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("sv-SE");
    const filteredPlayers = (players ?? []).filter((player) => {
      const matchesQuery = `${player.first_name} ${player.last_name} ${getClubName(player)}`
        .toLocaleLowerCase("sv-SE")
        .includes(normalizedQuery);
      const matchesClub = club === "all" || getClubName(player) === club;
      const isAffordable = Number(player.price) <= remainingBudget;

      return matchesQuery && matchesClub && (!affordableOnly || isAffordable);
    });

    if (priceSort === "default") return filteredPlayers;

    return filteredPlayers.toSorted((firstPlayer, secondPlayer) => {
      const priceDifference = Number(firstPlayer.price) - Number(secondPlayer.price);
      return priceSort === "low-to-high" ? priceDifference : -priceDifference;
    });
  }, [affordableOnly, club, players, priceSort, query, remainingBudget]);

  const slotLabel = position === "starter" ? "main player" : "bench player";
  const isReplacement = Boolean(outgoingPlayerId);
  const activeFilterCount = Number(club !== "all")
    + Number(priceSort !== "default")
    + Number(affordableOnly);

  return (
    <>
      <button
        className={trigger === "replace"
          ? "h-12 w-full rounded-md border border-white/20 bg-white/5 px-4 text-sm font-semibold text-sky-100 transition hover:border-white/60 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          : "group flex h-28 min-w-0 w-full flex-col items-center justify-center rounded-md border border-dashed border-sky-200/35 bg-sky-950/35 px-4 py-6 text-sky-100/70 transition hover:border-sky-100 hover:bg-sky-900/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"}
        disabled={transfersLocked}
        onClick={openPicker}
        type="button"
      >
        {trigger === "slot" ? <span className="flex h-10 w-10 items-center justify-center rounded-full border border-current text-2xl leading-none transition group-hover:scale-105">+</span> : null}
        <span className={trigger === "slot" ? "mt-3 text-sm font-semibold" : ""}>{isReplacement ? "Replace player" : `Add ${slotLabel}`}</span>
      </button>

      <dialog
        aria-labelledby={`player-picker-title-${position}`}
        className="m-auto h-[100dvh] max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-white backdrop:bg-slate-950/75 sm:h-auto sm:max-h-[85dvh] sm:w-[min(56rem,calc(100%-2rem))] sm:rounded-xl"
        ref={dialogRef}
      >
        <div className="flex h-full min-h-0 max-h-[100dvh] flex-col overflow-hidden border border-white/15 bg-sky-950 shadow-2xl sm:max-h-[85dvh] sm:rounded-xl">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 p-5 sm:p-6">
            <div>
              <h2 className="text-xl font-bold" id={`player-picker-title-${position}`}>{isReplacement ? "Replace player" : `Add ${slotLabel}`}</h2>
              <p className="mt-1 text-sm text-sky-100/60">Remaining budget: {formatMoney(remainingBudget)}</p>
            </div>
            <button aria-label="Close player picker" className="rounded-md px-3 py-1 text-2xl text-sky-100/60 hover:bg-white/10 hover:text-white" onClick={() => dialogRef.current?.close()} type="button">×</button>
          </div>

          <div className="shrink-0 border-b border-white/10 p-5 sm:p-6">
            <div className="flex gap-3">
              <input aria-label="Search players" className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-base outline-none placeholder:text-sky-100/40 focus:border-sky-100 sm:text-sm" onChange={(event) => setQuery(event.target.value)} placeholder="Search player or club…" value={query} />
              <button
                aria-controls={`player-picker-filters-${position}`}
                aria-expanded={filtersOpen}
                className="flex shrink-0 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-sky-50 transition hover:border-white/30 hover:bg-white/10"
                onClick={() => setFiltersOpen((open) => !open)}
                type="button"
              >
                <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                </svg>
                <span>Filters</span>
                {activeFilterCount > 0 ? (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-100 px-1 text-xs text-sky-950">
                    {activeFilterCount}
                  </span>
                ) : null}
                <svg
                  aria-hidden="true"
                  className={`h-4 w-4 ${filtersOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </button>
            </div>

            {filtersOpen ? (
              <div
                className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                id={`player-picker-filters-${position}`}
              >
                <select aria-label="Filter by club" className="rounded-md border border-white/15 bg-sky-950 px-3 py-2 text-base outline-none focus:border-sky-100 sm:text-sm" onChange={(event) => setClub(event.target.value)} value={club}>
                  <option value="all">All clubs</option>
                  {clubs.map((clubName) => <option key={clubName} value={clubName}>{clubName}</option>)}
                </select>
                <select
                  aria-label="Sort players by price"
                  className="rounded-md border border-white/15 bg-sky-950 px-3 py-2 text-base outline-none focus:border-sky-100 sm:text-sm"
                  onChange={(event) => setPriceSort(event.target.value as PriceSort)}
                  value={priceSort}
                >
                  <option value="default">Default order</option>
                  <option value="low-to-high">Price: Low to high</option>
                  <option value="high-to-low">Price: High to low</option>
                </select>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-sky-50 sm:col-span-2 lg:col-span-1">
                  <input
                    checked={affordableOnly}
                    className="h-4 w-4 shrink-0 accent-emerald-400"
                    onChange={(event) => setAffordableOnly(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="whitespace-nowrap">Only affordable</span>
                </label>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-5 [-webkit-overflow-scrolling:touch] sm:p-6">
            {!players && !error ? <p className="py-12 text-center text-sm text-sky-100/60">Loading players…</p> : null}
            {error ? <div className="rounded-md border border-red-300/30 bg-red-400/10 p-4 text-sm text-red-100">{error}</div> : null}
            {players ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {visiblePlayers.map((player) => {
                  const selected = selectedIds.has(player.id);
                  const tooExpensive = Number(player.price) > remainingBudget;
                  const playerClubId = getClubId(player);
                  const clubLimitReached = Boolean(
                    playerClubId
                      && (clubCounts.get(playerClubId) ?? 0) >= MAX_PLAYERS_PER_CLUB,
                  );
                  return (
                    <div className="flex items-center gap-3 rounded-md border border-white/15 bg-white/5 p-3" key={player.id}>
                      <ClubLogo player={player} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{player.first_name} {player.last_name}</p>
                        <p className="mt-1 truncate text-xs text-sky-100/55">{getClubName(player)} · {formatMoney(player.price)}</p>
                      </div>
                      <button
                        className="rounded-md bg-sky-100 px-3 py-2 text-xs font-bold text-sky-950 hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                        disabled={selected || tooExpensive || clubLimitReached || transfersLocked}
                        onClick={() => {
                          onSelect(player);
                          dialogRef.current?.close();
                        }}
                        type="button"
                      >
                          {selected ? "Selected" : tooExpensive ? "Over budget" : clubLimitReached ? "Club limit" : "Add"}
                      </button>
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

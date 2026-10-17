"use client";

import { canSelectPlayer, comparePlayerPrices, hasConfiguredPrice } from "@/lib/player-availability";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { canonicalClubName } from "@/lib/clubs";
import { getClubLogo } from "@/app/dashboard/club-logos";
import { canTransferFromClub, MAX_PLAYERS_PER_CLUB } from "@/lib/squad-club-limit";
import type { DashboardPlayer, SquadPosition, TransferPlayer } from "@/app/dashboard/player-types";
import { useBodyScrollLock } from "@/app/dashboard/use-body-scroll-lock";
import { PlayerStatisticsDialog } from "@/app/dashboard/player-statistics-button";
import { formatOwnership, winRate } from "@/lib/player-statistics";

type PlayerPickerProps = {
  onSelect: (player: DashboardPlayer) => void;
  position: SquadPosition;
  remainingBudget: number;
  selectedClubIds: string[];
  selectedPlayerIds: string[];
  transfersLocked: boolean;
  outgoingClubId?: string;
  outgoingPlayerId?: string;
  outgoingPlayer?: DashboardPlayer;
  trigger: "court" | "replace";
  triggerLabel?: string;
  triggerClassName?: string;
  triggerIcon?: React.ReactNode;
};

type PlayerSort = "name" | "price" | "points" | "form" | "singles" | "ownership";
type Sorting = { column: PlayerSort; direction: "ascending" | "descending" };
type ComparisonPlayer = DashboardPlayer & Partial<TransferPlayer>;
const statisticsTriggerClass = "group flex min-h-11 w-full min-w-0 items-center gap-1.5 rounded-md py-2 text-left hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] sm:gap-2";

const statisticColumns: { column: PlayerSort; label: string; className?: string; colClassName?: string }[] = [
  { column: "price", label: "Price" },
  { column: "points", label: "Pts", className: "hidden sm:table-cell", colClassName: "hidden sm:table-column" },
  { column: "form", label: "Form" },
  { column: "ownership", label: "Owned %" },
  { column: "singles", label: "Singles %", className: "hidden md:table-cell", colClassName: "hidden md:table-column" },
];

function PlayerIdentity({ player }: { player: DashboardPlayer }) {
  return <>
    <ClubLogo player={player} />
    <span className="min-w-0 flex-1">
      <span className="block break-words text-xs font-bold leading-tight group-hover:text-[var(--pf-brand-blue-hover)] sm:text-sm">{player.first_name.slice(0, 1)}. {player.last_name}</span>
      <span className="mt-0.5 block truncate text-[10px] text-[var(--pf-text-muted)] sm:text-xs">{getClubName(player)}</span>
    </span>
  </>;
}

function StatisticCells({ player, sortedColumn, onStatistics }: { player: ComparisonPlayer; sortedColumn: PlayerSort; onStatistics: (player: DashboardPlayer) => void }) {
  const numberColor = (column: PlayerSort) => sortedColumn === column ? "text-[var(--pf-text)]" : "text-[var(--pf-text-muted)]";
  const rate = player.singles_wins === undefined || player.singles_losses === undefined ? null : winRate(player.singles_wins, player.singles_losses);
  const values = [
    !hasConfiguredPrice(player.price) ? "—" : formatMoney(player.price),
    player.total_points ?? "—",
    player.form == null ? "—" : Number(player.form).toFixed(1),
    formatOwnership(player.owned_percent ?? null),
    rate === null ? "—" : `${rate}%`,
  ];
  return statisticColumns.map(({ column, label, className = "" }, index) => <td className={`text-center text-xs tabular-nums sm:text-sm ${className} ${numberColor(column)}`} key={column}>
    <button aria-label={`View ${label} statistics for ${player.first_name} ${player.last_name}`} aria-haspopup="dialog" className="min-h-11 w-full rounded-md py-2 hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]" onClick={() => onStatistics(player)} type="button">{values[index]}</button>
  </td>);
}

function OutgoingPlayerCard({ player, onStatistics }: { player: DashboardPlayer; onStatistics: (player: DashboardPlayer) => void }) {
  return <section aria-label="Outgoing player" className="mb-4 rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 pt-2 sm:px-4">
    <p className="text-[10px] font-semibold tracking-widest text-[var(--pf-text-muted)]">PLAYER TO REPLACE</p>
    <div className="flex items-center gap-3">
      <button aria-label={`View statistics for ${player.first_name} ${player.last_name}`} aria-haspopup="dialog" className={`${statisticsTriggerClass} flex-1`} onClick={() => onStatistics(player)} type="button"><PlayerIdentity player={player} /></button>
      <button aria-label={`View Price statistics for ${player.first_name} ${player.last_name}`} aria-haspopup="dialog" className="min-h-11 shrink-0 rounded-md px-1 text-sm font-bold tabular-nums hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]" onClick={() => onStatistics(player)} type="button">{hasConfiguredPrice(player.price) ? formatMoney(player.price) : "—"}</button>
    </div>
  </section>;
}

function SortableHeader({ column, label, sorting, onSort, className = "" }: {
  column: PlayerSort;
  label: string;
  sorting: Sorting;
  onSort: (column: PlayerSort) => void;
  className?: string;
}) {
  const active = sorting.column === column;
  return (
    <th aria-sort={active ? sorting.direction : "none"} className={`${column === "name" ? "text-left" : "w-11 min-[360px]:w-12 sm:w-[10%]"} ${className}`} scope="col">
      <button
        aria-label={`Sort by ${label}`}
        className={`flex min-h-11 w-full items-center gap-0.5 rounded-md text-[10px] font-semibold transition hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] sm:gap-1 sm:text-xs ${column === "name" ? "justify-start" : "justify-center"} ${active ? "bg-[var(--pf-brand-blue-soft)] text-[var(--pf-brand-blue-hover)] ring-1 ring-inset ring-[var(--pf-brand-blue-border)]" : ""}`}
        onClick={() => onSort(column)}
        type="button"
      >
        <span className="whitespace-nowrap">{column === "ownership" ? <>Owned<span className="block sm:inline"> %</span></> : label}</span>
        {active ? <svg aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 ${sorting.direction === "ascending" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 16 16"><path d="M8 3v10m-3-3 3 3 3-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg> : null}
      </button>
    </th>
  );
}

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
}

function getClubName(player: DashboardPlayer) {
  const name = Array.isArray(player.clubs) ? player.clubs[0]?.name : player.clubs?.name;
  return canonicalClubName(name ?? "Free agent");
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
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-text)] p-0.5 sm:h-9 sm:w-9 sm:p-1">
      {logo ? (
        <Image
          alt={logo.alt}
          className="h-auto w-auto max-h-full max-w-full object-contain"
          height={32}
          src={logo.src}
          width={32}
        />
      ) : (
        <span className="text-xs font-bold text-[var(--pf-navy)]">{clubName.slice(0, 1)}</span>
      )}
    </div>
  );
}

// Shared by all six picker instances; retry failures and refresh on reopening.
let catalogue: { players: TransferPlayer[]; expiresAt: number } | undefined;
let catalogueRequest: Promise<TransferPlayer[]> | undefined;

async function loadCatalogue() {
  if (catalogue && catalogue.expiresAt > Date.now()) return catalogue.players;
  if (!catalogueRequest) {
    catalogueRequest = (async () => {
      const response = await fetch("/api/players", { cache: "no-store" });
      const payload = (await response.json()) as { players?: TransferPlayer[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load players.");
      const players = payload.players ?? [];
      catalogue = { players, expiresAt: Date.now() + 60_000 };
      return players;
    })().finally(() => { catalogueRequest = undefined; });
  }
  return catalogueRequest;
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
  outgoingPlayer,
  trigger,
  triggerLabel,
  triggerClassName,
  triggerIcon,
}: PlayerPickerProps) {
  const clubRepairBlocked = !canTransferFromClub(selectedClubIds, outgoingClubId ?? null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [players, setPlayers] = useState<TransferPlayer[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [club, setClub] = useState("all");
  const [sorting, setSorting] = useState<Sorting>({ column: "price", direction: "descending" });
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [statisticsPlayer, setStatisticsPlayer] = useState<DashboardPlayer | null>(null);

  useBodyScrollLock(pickerOpen);

  async function openPicker() {
    if (transfersLocked || clubRepairBlocked) return;
    setFiltersOpen(false);
    dialogRef.current?.showModal();
    setPickerOpen(true);

    setError("");
    try {
      setPlayers(await loadCatalogue());
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
      const isAffordable = canSelectPlayer(player) && Number(player.price) <= remainingBudget;

      return matchesQuery && matchesClub && (!affordableOnly || isAffordable);
    });

    return filteredPlayers.toSorted((firstPlayer, secondPlayer) => {
      const metric = (player: TransferPlayer) => sorting.column === "points" ? player.total_points
        : sorting.column === "form" ? player.form
        : sorting.column === "ownership" ? player.owned_percent : winRate(player.singles_wins, player.singles_losses);
      const first = metric(firstPlayer);
      const second = metric(secondPlayer);
      const difference = sorting.column === "name"
        ? firstPlayer.last_name.localeCompare(secondPlayer.last_name, "sv-SE") * (sorting.direction === "ascending" ? 1 : -1)
        : sorting.column === "price"
        ? comparePlayerPrices(firstPlayer, secondPlayer, sorting.direction === "ascending")
        : first === null || second === null ? Number(first === null) - Number(second === null)
        : (first - second) * (sorting.direction === "ascending" ? 1 : -1);
      return difference || `${firstPlayer.last_name} ${firstPlayer.first_name}`.localeCompare(`${secondPlayer.last_name} ${secondPlayer.first_name}`, "sv-SE") || firstPlayer.id.localeCompare(secondPlayer.id);
    });
  }, [affordableOnly, club, players, sorting, query, remainingBudget]);

  function sortBy(column: PlayerSort) {
    setSorting((current) => ({
      column,
      direction: current.column === column
        ? current.direction === "descending" ? "ascending" : "descending"
        : column === "name" ? "ascending" : "descending",
    }));
  }

  const slotLabel = position === "starter" ? "main player" : "bench player";
  const isReplacement = Boolean(outgoingPlayerId);
  const activeFilterCount = Number(club !== "all")
    + Number(affordableOnly);

  return (
    <>
      <button
        className={triggerClassName ?? (
          trigger === "replace"
            ? "h-12 w-full rounded-md bg-[var(--pf-brand-blue)] px-2 text-xs font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)] disabled:cursor-not-allowed disabled:bg-[var(--pf-navy-elevated)] disabled:text-[var(--pf-text-muted)] disabled:opacity-60 sm:text-sm"
            : "group flex min-h-28 w-full max-w-52 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--pf-text-muted)]/45 bg-[var(--pf-navy)]/25 px-2 py-4 text-[var(--pf-text)]/80 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-navy)]/45 hover:text-[var(--pf-text)] active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] disabled:cursor-not-allowed disabled:opacity-40"
        )}
        disabled={transfersLocked || clubRepairBlocked}
        onClick={openPicker}
        type="button"
      >
        {triggerIcon}
        {trigger !== "replace" ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-current text-xl leading-none transition group-hover:scale-105 sm:h-10 sm:w-10 sm:text-2xl">
            +
          </span>
        ) : null}
        <span
          className={
            trigger === "replace"
              ? ""
              : "mt-2 text-xs font-semibold sm:mt-3 sm:text-sm"
          }
        >
          {triggerLabel ??
            (isReplacement ? "Replace player" : "Add player")}
        </span>
      </button>

      <dialog
        aria-labelledby={`player-picker-title-${position}`}
        className="m-auto h-[100dvh] max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-[var(--pf-text)] backdrop:bg-[var(--pf-navy-deep)]/80 sm:h-auto sm:max-h-[85dvh] sm:w-[min(56rem,calc(100%-2rem))] sm:rounded-xl"
        ref={dialogRef}
      >
        <div className="flex h-full min-h-0 max-h-[100dvh] flex-col overflow-hidden border border-[var(--pf-card-border)] bg-[var(--pf-navy)] shadow-2xl sm:max-h-[85dvh] sm:rounded-xl">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--pf-card-border)]/60 px-3 py-3 sm:p-6">
            <div>
              <h2 className="text-xl font-bold" id={`player-picker-title-${position}`}>{isReplacement ? "Replace player" : `Add ${slotLabel}`}</h2>
              <p className="mt-1 text-sm text-[var(--pf-text-muted)]">Remaining budget: {formatMoney(remainingBudget)}</p>
            </div>
            <button aria-label="Close player picker" className="rounded-md px-3 py-1 text-2xl text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-text)]" onClick={() => dialogRef.current?.close()} type="button">×</button>
          </div>

          <div className="shrink-0 border-b border-[var(--pf-card-border)]/60 p-3 sm:px-6 sm:py-4">
            <div className="flex gap-2 sm:gap-3">
              <input
                aria-label="Search players"
                className="h-9 min-w-0 flex-1 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-3 text-base text-[var(--pf-text)] outline-none placeholder:text-xs placeholder:text-[var(--pf-text-muted)]/60 focus:border-[var(--pf-brand-blue)] sm:text-sm"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search player or club…"
                suppressHydrationWarning
                value={query}
              />
              <button
                aria-controls={`player-picker-filters-${position}`}
                aria-expanded={filtersOpen}
                className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-2 text-xs font-semibold text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] sm:px-3 sm:text-sm"
                onClick={() => setFiltersOpen((open) => !open)}
                type="button"
              >
                <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                </svg>
                <span>Filters</span>
                {activeFilterCount > 0 ? (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--pf-brand-blue)] px-1 text-xs text-[var(--pf-navy-deep)]">
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
                <select aria-label="Filter by club" className="rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-3 py-2 text-base text-[var(--pf-text)] outline-none focus:border-[var(--pf-brand-blue)] sm:text-sm" onChange={(event) => setClub(event.target.value)} value={club}>
                  <option value="all">All clubs</option>
                  {clubs.map((clubName) => <option key={clubName} value={clubName}>{clubName}</option>)}
                </select>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-3 py-2 text-sm text-[var(--pf-text)] sm:col-span-2 lg:col-span-1">
                  <input
                    checked={affordableOnly}
                    className="h-4 w-4 shrink-0 accent-[var(--pf-brand-blue)]"
                    onChange={(event) => setAffordableOnly(event.target.checked)}
                    suppressHydrationWarning
                    type="checkbox"
                  />
                  <span className="whitespace-nowrap">Only affordable</span>
                </label>
              </div>
            ) : null}
          </div>

          <div aria-label="Transfer player list" className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-3 [-webkit-overflow-scrolling:touch] sm:p-6">
            {outgoingPlayer ? <OutgoingPlayerCard player={players?.find((player) => player.id === outgoingPlayer.id) ?? outgoingPlayer} onStatistics={setStatisticsPlayer} /> : null}
            {!players && !error ? <p className="py-12 text-center text-sm text-[var(--pf-text-muted)]">Loading players…</p> : null}
            {error ? <div className="rounded-md border border-[var(--pf-coral)]/45 bg-[var(--pf-coral-soft)] p-4 text-sm text-[var(--pf-coral-text)]">{error}</div> : null}
            {players ? (
              <div>
                <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-widest text-[var(--pf-text-muted)]">AVAILABLE PLAYERS <span className="rounded bg-[var(--pf-navy-elevated)] px-1.5 py-0.5 tabular-nums tracking-normal">{visiblePlayers.length}</span></p>
                <table className="w-full table-fixed text-sm">
                  <caption className="sr-only">Players available for transfer with price, points, recent form, ownership and singles win rate</caption>
                  <colgroup>
                    <col />
                    {statisticColumns.map(({ column, colClassName = "" }) => <col className={`w-11 min-[360px]:w-12 sm:w-[10%] ${colClassName}`} key={column} />)}
                    <col className="w-16 sm:w-20" />
                  </colgroup>
                  <thead className="bg-[var(--pf-navy)] text-xs text-[var(--pf-text-muted)]">
                  <tr className="border-b border-[var(--pf-card-border)]/50">
                    <SortableHeader column="name" label="Player" sorting={sorting} onSort={sortBy} />
                    {statisticColumns.map(({ column, label, className }) => <SortableHeader column={column} label={label} sorting={sorting} onSort={sortBy} className={className} key={column} />)}
                    <th className="w-16 pb-2 sm:w-20" scope="col"><span className="sr-only">Transfer</span></th>
                  </tr></thead>
                  <tbody className="divide-y divide-[var(--pf-card-border)]/40">
                {visiblePlayers.map((player) => {
                  const selected = selectedIds.has(player.id);
                  const notSelectable = !canSelectPlayer(player);
                  const tooExpensive = Number(player.price) > remainingBudget;
                  const playerClubId = getClubId(player);
                  const clubLimitReached = Boolean(
                    playerClubId
                      && (clubCounts.get(playerClubId) ?? 0) >= MAX_PLAYERS_PER_CLUB,
                  );
                  const unavailable =
                    notSelectable || (!selected && (tooExpensive || clubLimitReached));
                  const disabled = notSelectable || selected || tooExpensive || clubLimitReached || transfersLocked || clubRepairBlocked;
                  const selectionLabel = notSelectable ? "Unavailable" : selected ? "Selected" : transfersLocked ? "Locked" : tooExpensive ? "Over budget" : clubRepairBlocked || clubLimitReached ? "Club limit" : "Add";
                  const selectPlayer = () => { onSelect(player); dialogRef.current?.close(); };
                  return (
                    <tr className={selected ? "bg-[var(--pf-brand-blue-soft)]" : "bg-[var(--pf-navy-elevated)]"} key={player.id}>
                      <td className="pr-1 sm:pr-3">
                        <button aria-label={`View statistics for ${player.first_name} ${player.last_name}`} aria-haspopup="dialog" className={statisticsTriggerClass} onClick={() => setStatisticsPlayer(player)} type="button">
                          <PlayerIdentity player={player} />
                        </button>
                      </td>
                      <StatisticCells player={player} sortedColumn={sorting.column} onStatistics={setStatisticsPlayer} />
                      <td className="py-1 text-right sm:py-2 sm:pl-2">
                      <button
                        aria-label={selectionLabel === "Add" ? "Add" : selectionLabel}
                        title={`${selectionLabel} ${player.first_name} ${player.last_name}`}
                        className={`min-h-8 w-14 rounded-md px-1 py-1 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] sm:w-18 ${disabled ? "text-[10px] leading-tight sm:text-xs" : "text-lg leading-none"} ${
                          selected
                            ? "bg-[var(--pf-brand-blue-soft)] text-[var(--pf-brand-blue-hover)]"
                            : unavailable
                              ? "cursor-not-allowed bg-[var(--pf-card-border)] text-[var(--pf-text-muted)]"
                              : "bg-[var(--pf-brand-blue)] text-[var(--pf-text)] hover:bg-[var(--pf-brand-blue-hover)] disabled:bg-[var(--pf-navy-deep)] disabled:text-[var(--pf-text-muted)]/55"
                        }`}
                        disabled={disabled}
                        onClick={selectPlayer}
                        type="button"
                      >
                          {disabled ? selectionLabel : "+"}
                      </button>
                      </td>
                    </tr>
                  );
                })}
                  </tbody>
                </table>
                {!visiblePlayers.length ? <p className="py-10 text-center text-sm text-[var(--pf-text-muted)]">No players match your filters.</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </dialog>
      {statisticsPlayer ? <PlayerStatisticsDialog key={statisticsPlayer.id} player={statisticsPlayer} onClose={() => setStatisticsPlayer(null)} /> : null}
    </>
  );
}

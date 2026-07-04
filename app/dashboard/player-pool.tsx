"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { addPlayerToTeam, swapPlayerIntoTeam } from "@/app/dashboard/actions";
import { getClubLogo } from "@/app/dashboard/club-logos";

const SQUAD_SIZE = 6;

export type DashboardPlayer = {
  id: string;
  first_name: string;
  last_name: string;
  birth_year: number | null;
  price: number | string;
  clubs: { name: string } | { name: string }[] | null;
};

export type SquadPlayerOption = DashboardPlayer & {
  position: "starter" | "bench";
};

type SortField = "name" | "club" | "price";
type SortDirection = "asc" | "desc";

type PlayerPoolProps = {
  players: DashboardPlayer[];
  selectedPlayerIds: string[];
  squadPlayers: SquadPlayerOption[];
  squadSize: number;
  remainingBudget: number;
  transfersLocked: boolean;
};

function formatMoney(value: number | string) {
  return `${(Number(value) / 1000000).toFixed(1)}m`;
}

function getClubName(player: DashboardPlayer) {
  return Array.isArray(player.clubs)
    ? player.clubs[0]?.name
    : player.clubs?.name ?? "Free agent";
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, "sv-SE", { sensitivity: "base" });
}

function ClubLogoBadge({ clubName }: { clubName: string }) {
  const logo = getClubLogo(clubName);

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white p-1">
      {logo ? (
        <Image
          alt={logo.alt}
          className="max-h-7 max-w-7 object-contain"
          height={28}
          src={logo.src}
          width={28}
        />
      ) : (
        <span className="text-xs font-bold text-zinc-500">
          {clubName.slice(0, 1)}
        </span>
      )}
    </div>
  );
}

export function PlayerPool({
  players,
  selectedPlayerIds,
  squadPlayers,
  squadSize,
  remainingBudget,
  transfersLocked,
}: PlayerPoolProps) {
  const [sortField, setSortField] = useState<SortField>("price");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const selectedIds = useMemo(
    () => new Set(selectedPlayerIds),
    [selectedPlayerIds],
  );

  const sortedPlayers = useMemo(() => {
    return [...players].sort((left, right) => {
      const direction = sortDirection === "asc" ? 1 : -1;

      if (sortField === "name") {
        const byLastName = compareText(left.last_name, right.last_name);

        if (byLastName !== 0) {
          return byLastName * direction;
        }

        return compareText(left.first_name, right.first_name) * direction;
      }

      if (sortField === "club") {
        const byClub = compareText(getClubName(left), getClubName(right));

        if (byClub !== 0) {
          return byClub * direction;
        }

        return compareText(left.last_name, right.last_name);
      }

      const byPrice = Number(left.price) - Number(right.price);

      if (byPrice !== 0) {
        return byPrice * direction;
      }

      return compareText(left.last_name, right.last_name);
    });
  }, [players, sortDirection, sortField]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortField(field);
    setSortDirection(field === "price" ? "desc" : "asc");
  }

  function sortLabel(field: SortField) {
    if (sortField !== field) {
      return "";
    }

    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  return (
    <div className="mt-5 overflow-hidden rounded-md border border-white/15 bg-sky-950/50">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-white/10 text-xs uppercase text-sky-100/60">
          <tr>
            <th className="px-4 py-3">
              <button
                className="transition hover:text-white"
                onClick={() => toggleSort("name")}
                type="button"
              >
                Player{sortLabel("name")}
              </button>
            </th>
            <th className="px-4 py-3">Born</th>
            <th className="px-4 py-3">
              <button
                className="transition hover:text-white"
                onClick={() => toggleSort("club")}
                type="button"
              >
                Club{sortLabel("club")}
              </button>
            </th>
            <th className="px-4 py-3 text-right">
              <button
                className="transition hover:text-white"
                onClick={() => toggleSort("price")}
                type="button"
              >
                Price{sortLabel("price")}
              </button>
            </th>
            <th className="px-4 py-3 text-right">Team</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {sortedPlayers.length ? (
            sortedPlayers.map((player) => {
              const isSelected = selectedIds.has(player.id);
              const isFull = squadSize >= SQUAD_SIZE;
              const isTooExpensive = Number(player.price) > remainingBudget;
              const swapOptions = squadPlayers.filter(
                (squadPlayer) =>
                  Number(player.price) <=
                  remainingBudget + Number(squadPlayer.price),
              );
              const cannotAdd = transfersLocked || isSelected || isFull || isTooExpensive;
              const cannotSwap = transfersLocked || isSelected || !isFull || swapOptions.length === 0;

              return (
                <tr className="transition hover:bg-white/5" key={player.id}>
                  <td className="px-4 py-3 font-medium">
                    {player.first_name} {player.last_name}
                  </td>
                  <td className="px-4 py-3 text-sky-100/60">
                    {player.birth_year ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-sky-100/70">
                    <div className="flex items-center gap-3">
                      <ClubLogoBadge clubName={getClubName(player)} />
                      <span>{getClubName(player)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-sky-100">
                    {formatMoney(player.price)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isSelected ? (
                      <span className="inline-flex rounded-md border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100">
                        Selected
                      </span>
                    ) : isFull ? (
                      <form action={swapPlayerIntoTeam} className="flex justify-end gap-2">
                        <input name="player_id" type="hidden" value={player.id} />
                        <select
                          className="max-w-36 rounded-md border border-white/15 bg-sky-950 px-2 py-2 text-xs font-semibold text-sky-50 outline-none transition focus:border-sky-100 disabled:cursor-not-allowed disabled:text-sky-100/35"
                          defaultValue=""
                          disabled={cannotSwap}
                          name="outgoing_player_id"
                          required
                        >
                          <option disabled value="">
                            Swap with
                          </option>
                          {swapOptions.map((squadPlayer) => (
                            <option key={squadPlayer.id} value={squadPlayer.id}>
                              {squadPlayer.first_name} {squadPlayer.last_name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="rounded-md bg-sky-100 px-3 py-2 text-xs font-bold text-sky-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                          disabled={cannotSwap}
                        >
                          Swap in
                        </button>
                      </form>
                    ) : (
                      <form action={addPlayerToTeam}>
                        <input name="player_id" type="hidden" value={player.id} />
                        <button
                          className="rounded-md bg-sky-100 px-3 py-2 text-xs font-bold text-sky-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                          disabled={cannotAdd}
                        >
                          Add
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td className="px-4 py-6 text-sky-100/60" colSpan={5}>
                No players yet. Add clubs and players in Supabase to fill this
                list.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

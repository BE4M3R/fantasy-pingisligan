import Image from "next/image";
import { getClubLogo } from "@/app/dashboard/club-logos";
import type { DraftSquadPlayer } from "@/app/dashboard/player-types";
import { canonicalClubName } from "@/lib/clubs";

export function squadCardShellClass(player: DraftSquadPlayer, { isOpen = false, compact = false }: {
  isOpen?: boolean;
  compact?: boolean;
} = {}) {
  const border = isOpen
    ? "border-[var(--pf-brand-blue)] ring-2 ring-[var(--pf-brand-blue)]/35"
    : player.active === false
      ? "border-[var(--pf-coral)]"
      : player.is_captain
        ? "border-[var(--pf-fantasy-yellow)]/70"
        : "border-[var(--pf-card-border)]";

  const size = compact
    ? "w-[96%] max-w-[12.25rem] px-1.5 py-2 sm:px-3 sm:py-2.5"
    : "w-full max-w-52 px-2 py-2.5 sm:px-4 sm:py-3";

  return `group relative min-w-0 overflow-hidden rounded-lg border bg-[var(--pf-navy)] text-center shadow-lg shadow-[var(--pf-navy-deep)]/30 ${size} ${border}`;
}

export function SquadCardVisual({
  player,
  resultPoints,
  automaticSubstitution,
}: {
  player: DraftSquadPlayer;
  resultPoints?: number;
  automaticSubstitution?: "in" | "out" | null;
}) {
  const clubName = Array.isArray(player.clubs)
    ? player.clubs[0]?.name
    : player.clubs?.name;
  const club = canonicalClubName(clubName ?? "Free agent");
  const logo = getClubLogo(club);
  const firstInitial = player.first_name.trim().slice(0, 1);
  const cardName = firstInitial
    ? `${firstInitial}.${player.last_name}`
    : player.last_name;

  return (
    <div className="flex min-w-0 w-full flex-col items-center">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/15 bg-[var(--pf-text)] p-1">
        {logo ? (
          <Image
            alt={logo.alt}
            className="h-auto w-auto max-h-9 max-w-9 object-contain"
            height={36}
            src={logo.src}
            width={36}
          />
        ) : (
          <span className="text-xs font-bold text-zinc-500">
            {club.slice(0, 1)}
          </span>
        )}
      </div>
      <h3 className="mt-1.5 line-clamp-2 min-w-0 w-full break-words text-xs font-black leading-[1.15] text-[var(--pf-text)] sm:text-sm">
        {cardName}
      </h3>
      <p className="mt-1 hidden min-w-0 w-full leading-tight text-[var(--pf-text-muted)] sm:line-clamp-1 sm:text-[0.7rem]">
        {club}
      </p>
      <p className="mt-0.5 text-[0.65rem] font-bold text-[var(--pf-text)] sm:text-xs">
        {resultPoints === undefined
          ? `${(Number(player.price) / 1000000).toFixed(1)}m`
          : `${resultPoints} pts`}
      </p>
      {player.is_captain || player.active === false || automaticSubstitution ? (
        <div className="absolute left-1.5 top-1.5 z-10 flex flex-col items-start gap-1 sm:static sm:mt-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
          {player.is_captain ? (
            <span
              aria-label="Captain"
              className="inline-flex items-center justify-center rounded-full bg-[var(--pf-fantasy-yellow)] font-black uppercase tracking-wide text-[var(--pf-navy-deep)]"
              style={{ fontSize: "0.6rem", lineHeight: 1, padding: "0.2rem 0.5rem", whiteSpace: "nowrap" }}
            >
              <span className="sm:hidden">C</span>
              <span className="hidden sm:inline">Captain</span>
            </span>
          ) : null}
          {player.active === false ? (
            <span className="inline-flex items-center justify-center rounded-full bg-[var(--pf-coral-soft)] px-2 py-0.5 text-[0.55rem] font-black uppercase leading-none text-[var(--pf-coral-text)] ring-1 ring-[var(--pf-coral)]/60">
              N/A
            </span>
          ) : null}
          {automaticSubstitution ? (
            <span
              aria-label={automaticSubstitution === "in" ? "Subbed in" : "Subbed out"}
              className="inline-flex items-center justify-center rounded-full bg-[var(--pf-brand-blue-soft)] px-2 py-0.5 text-[0.55rem] font-black uppercase leading-none text-[var(--pf-brand-blue-hover)] ring-1 ring-[var(--pf-brand-blue-border)]"
            >
              <span className="sm:hidden">{automaticSubstitution === "in" ? "Sub in" : "Sub out"}</span>
              <span className="hidden sm:inline">{automaticSubstitution === "in" ? "Subbed in" : "Subbed out"}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Chip = "wildcard" | "triple_captain" | "bench_boost";

export type ChipSelection = {
  chip: Chip;
  fantasy_gameweek_id: string;
  locked_at: string | null;
  used_at: string | null;
};

type UpcomingGameweek = {
  id: string;
  lock_at: string;
  name: string;
};

const chips: { description: string; label: string; value: Chip }[] = [
  {
    description: "Unlimited transfers before the deadline.",
    label: "Wildcard",
    value: "wildcard",
  },
  {
    description: "Your captain scores 3x instead of 2x.",
    label: "Triple Captain",
    value: "triple_captain",
  },
  {
    description: "Both bench players count toward your score.",
    label: "Bench Boost",
    value: "bench_boost",
  },
];

function getChipLabel(value: Chip) {
  return chips.find((chip) => chip.value === value)?.label ?? value;
}

function getChipBallClassName({
  compact,
  isActive,
  isUsed,
}: {
  compact: boolean;
  isActive: boolean;
  isUsed: boolean;
}) {
  const sizeClass = compact ? "max-w-14" : "max-w-16 sm:max-w-20";
  let stateClass =
    "border-white/80 bg-white text-sky-950 group-hover:-translate-y-1 group-hover:bg-white group-focus-visible:ring-4 group-focus-visible:ring-sky-200/35";

  if (isActive) {
    stateClass = compact
      ? "border-emerald-200 bg-emerald-100 text-sky-950 ring-4 ring-emerald-300/30"
      : "border-emerald-100 bg-emerald-300 text-sky-950 ring-4 ring-emerald-300/20";
  } else if (isUsed) {
    stateClass = compact
      ? "border-white/60 bg-white text-slate-600 opacity-60 grayscale"
      : "border-slate-300/30 bg-slate-400 text-slate-700 opacity-40 grayscale";
  }

  return `chip-ball relative flex aspect-square w-full flex-col items-center justify-center rounded-full border-2 px-1.5 transition ${sizeClass} ${stateClass}`;
}

function ChipIcon({ chip }: { chip: Chip }) {
  if (chip === "wildcard") {
    return (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          d="M19 7v4h-4M5 17v-4h4m9.2-3A7 7 0 0 0 6.5 6.5L5 8m14 8-1.5 1.5A7 7 0 0 1 5.8 15"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (chip === "triple_captain") {
    return (
      <span aria-hidden="true" className="text-sm font-black tracking-tight">
        3×
      </span>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 19v-1.5A3.5 3.5 0 0 1 7 14h2a3.5 3.5 0 0 1 3.5 3.5V19m-1.8-4.2A3.5 3.5 0 0 1 13 14h2a3.5 3.5 0 0 1 3.5 3.5V19"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function ChipSelector({
  compact = false,
  migrationMissing,
  onChange,
  selectedChip,
  selections,
  transfersLocked,
  upcomingGameweek,
}: {
  compact?: boolean;
  migrationMissing: boolean;
  onChange: (chip: Chip | null) => void;
  selectedChip: Chip | null;
  selections: ChipSelection[];
  transfersLocked: boolean;
  upcomingGameweek: UpcomingGameweek | null;
}) {
  const usedChips = new Set(
    selections
      .filter((selection) => selection.locked_at)
      .map((selection) => selection.chip),
  );
  const lockedChip = selections.find(
    (selection) => selection.locked_at && !selection.used_at,
  );
  const [pendingChip, setPendingChip] = useState<Chip | null>(null);
  const chipTriggerRef = useRef<HTMLButtonElement | null>(null);
  const chipToConfirm = chips.find((chip) => chip.value === pendingChip);

  useEffect(() => {
    if (!pendingChip) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingChip(null);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [pendingChip]);

  function closeConfirmation() {
    setPendingChip(null);
    window.requestAnimationFrame(() => chipTriggerRef.current?.focus());
  }

  return (
    <section
      aria-label="Gameweek chips"
      className={compact ? "py-3" : "mt-4"}
    >
      {migrationMissing ? (
        <div className="mb-3 rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          Run supabase/chips-migration.sql in Supabase to enable chips.
        </div>
      ) : null}

      {lockedChip ? (
        <div className="mb-3 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
          {getChipLabel(lockedChip.chip)} is locked in for this gameweek.
        </div>
      ) : null}

      <div className="grid grid-cols-3 place-items-center gap-3">
        {chips.map((chip) => {
          const isSelected = selectedChip === chip.value;
          const isLocked = lockedChip?.chip === chip.value;
          const isActive = isSelected || isLocked;
          const isUsed = usedChips.has(chip.value) && !isLocked;
          const disabled =
            migrationMissing ||
            transfersLocked ||
            !upcomingGameweek ||
            isLocked ||
            isUsed;
          const accessibleState = isLocked
            ? "Activated and locked for this gameweek."
            : isSelected
              ? "Activated. Press again to deactivate."
              : isUsed
                ? "Already used this season."
                : "Not activated.";

          return (
            <button
              aria-label={`${chip.label}. ${
                isUsed ? "" : chip.description
              } ${accessibleState}`}
              aria-pressed={isActive}
              className="group flex w-full flex-col items-center rounded-full p-1 text-center focus-visible:outline-none disabled:cursor-not-allowed"
              disabled={disabled}
              key={chip.value}
              onClick={(event) => {
                chipTriggerRef.current = event.currentTarget;

                if (isSelected) {
                  onChange(null);
                  return;
                }

                setPendingChip(chip.value);
              }}
              title={chip.description}
              type="button"
            >
              <span
                className={getChipBallClassName({
                  compact,
                  isActive,
                  isUsed,
                })}
                style={
                  compact
                    ? {
                        backgroundColor:
                          isActive
                            ? "#d1fae5"
                            : isUsed
                              ? "#f8fafc"
                              : "#ffffff",
                      }
                    : undefined
                }
              >
                <ChipIcon chip={chip.value} />
                <span className="mt-0.5 text-[0.55rem] font-black leading-tight sm:text-[0.65rem]">
                  <span className="sm:hidden">
                    {chip.value === "triple_captain"
                      ? "3× Captain"
                      : chip.label}
                  </span>
                  <span className="hidden sm:inline">{chip.label}</span>
                </span>
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-sky-950 text-[0.55rem] font-black text-emerald-200 sm:right-1 sm:top-1"
                  >
                    {isLocked ? "●" : "✓"}
                  </span>
                ) : null}
                {isUsed ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-3 right-3 top-1/2 h-0.5 -rotate-45 bg-slate-700/70"
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {chipToConfirm && upcomingGameweek
        ? createPortal(
          <div
            aria-labelledby="chip-confirmation-title"
            aria-modal="true"
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/75 p-4 text-white"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeConfirmation();
            }}
            role="dialog"
          >
            <div className="w-full max-w-sm rounded-xl border border-white/15 bg-sky-950 p-5 shadow-2xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                    Gameweek chip
                  </p>
                  <h2 className="mt-1 text-xl font-bold" id="chip-confirmation-title">
                    {chipToConfirm.label}
                  </h2>
                </div>
                <button
                  aria-label="Close chip confirmation"
                  className="rounded-md px-3 py-1 text-2xl text-sky-100/60 hover:bg-white/10 hover:text-white"
                  onClick={closeConfirmation}
                  type="button"
                >
                  ×
                </button>
              </div>

              <p className="mt-4 text-sm leading-6 text-sky-100/75">
                {chipToConfirm.description}
              </p>

              <div className="mt-4 rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-sm leading-5 text-amber-100">
                Only one chip can be used per gameweek. Each chip can be used once during the season.
              </div>

              {selectedChip && selectedChip !== chipToConfirm.value ? (
                <p className="mt-3 text-xs leading-5 text-sky-100/60">
                  This will replace your selected {getChipLabel(selectedChip)} chip for {upcomingGameweek.name}.
                </p>
              ) : null}

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  autoFocus
                  className="h-12 rounded-md border border-white/20 bg-white/5 px-4 text-sm font-semibold text-sky-50 hover:border-white/50 hover:bg-white/10"
                  onClick={closeConfirmation}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-12 w-full rounded-md bg-emerald-300 px-4 text-sm font-bold text-sky-950 hover:bg-emerald-200"
                  onClick={() => {
                    onChange(chipToConfirm.value);
                    closeConfirmation();
                  }}
                  type="button"
                >
                  Select chip
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}
    </section>
  );
}

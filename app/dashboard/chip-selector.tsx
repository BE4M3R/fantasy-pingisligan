"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Chip = "wildcard" | "triple_captain" | "bench_boost";

export type ChipSelection = {
  chip: Chip;
  fantasy_gameweek_id: string;
  locked_at: string | null;
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
  isUnavailable,
  isUsed,
}: {
  compact: boolean;
  isActive: boolean;
  isUnavailable: boolean;
  isUsed: boolean;
}) {
  const sizeClass = compact ? "h-16 w-16" : "h-[4.5rem] w-[4.5rem] sm:h-20 sm:w-20";
  let stateClass =
    "border-[#fffaf0] bg-[#fff8e9] text-[var(--pf-navy)] group-hover:-translate-y-0.5 group-hover:border-white group-focus-visible:ring-4 group-focus-visible:ring-[var(--pf-brand-blue)]/35";

  if (isActive) {
    stateClass =
      "border-[var(--pf-brand-blue)] bg-[#fff8e9] text-[var(--pf-navy)] ring-4 ring-[var(--pf-brand-blue)]/30 group-focus-visible:ring-[var(--pf-brand-blue)]/50";
  } else if (isUsed) {
    stateClass =
      "border-slate-400/55 bg-slate-200 text-slate-600 opacity-55 grayscale";
  } else if (isUnavailable) {
    stateClass =
      "border-slate-300/45 bg-[#f1eee7] text-slate-600 opacity-45";
  }

  return `chip-ball relative flex shrink-0 items-center justify-center rounded-full border-2 transition ${sizeClass} ${stateClass}`;
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
      <span
        aria-hidden="true"
        className="flex flex-col items-center text-[var(--pf-fantasy-yellow)]"
      >
        <svg className="h-5 w-6" fill="currentColor" viewBox="0 0 24 18">
          <path d="m2 4 5 4 5-7 5 7 5-4-2 12H4L2 4Zm3 13h14v1H5v-1Z" />
        </svg>
        <span className="-mt-0.5 text-xs font-black tracking-tight text-[var(--pf-navy)]">
          3×
        </span>
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
  lockedGameweekId,
  migrationMissing,
  onChange,
  selectedChip,
  selections,
  transfersLocked,
  upcomingGameweek,
}: {
  compact?: boolean;
  lockedGameweekId: string | null;
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
    (selection) =>
      selection.locked_at &&
      selection.fantasy_gameweek_id === lockedGameweekId,
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
      className={compact ? "pt-3" : "mt-4"}
    >
      {migrationMissing ? (
        <div className="mb-3 rounded-md border border-[var(--pf-coral)]/45 bg-[var(--pf-coral-soft)] px-3 py-2 text-xs text-[var(--pf-coral-text)]">
          Run supabase/chips-migration.sql in Supabase to enable chips.
        </div>
      ) : null}

      {lockedChip ? (
        <div className="mb-3 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] px-3 py-2 text-xs text-[var(--pf-brand-blue-hover)]">
          {getChipLabel(lockedChip.chip)} is locked in for this gameweek.
        </div>
      ) : null}

      <div className="grid grid-cols-3 place-items-start gap-1.5 min-[390px]:gap-3">
        {chips.map((chip) => {
          const isSelected = selectedChip === chip.value;
          const isLocked = lockedChip?.chip === chip.value;
          const isActive = isSelected || isLocked;
          const isUsed = usedChips.has(chip.value) && !isLocked;
          const isUnavailable =
            migrationMissing || transfersLocked || !upcomingGameweek;
          const disabled =
            isUnavailable ||
            isLocked ||
            isUsed;
          const stateLabel = isActive
            ? "Selected"
            : isUsed
              ? "Used"
              : "Available";
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
              className="group flex min-w-0 w-full flex-col items-center rounded-lg px-0.5 py-1 text-center focus-visible:outline-none disabled:cursor-not-allowed"
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
                  isUnavailable,
                  isUsed,
                })}
              >
                <ChipIcon chip={chip.value} />
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--pf-brand-blue)] text-[0.55rem] font-black text-[var(--pf-navy-deep)] sm:right-0.5 sm:top-0.5"
                  >
                    {isLocked ? "•" : "✓"}
                  </span>
                ) : null}
                {isUsed ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-3 right-3 top-1/2 h-0.5 -rotate-45 bg-slate-700/70"
                  />
                ) : null}
              </span>
              <span className="mt-2 min-h-7 text-[0.62rem] font-black leading-[1.15] text-[var(--pf-text)] min-[390px]:text-[0.68rem] sm:text-xs">
                {chip.value === "triple_captain" ? "3× Captain" : chip.label}
              </span>
              <span
                className={`mt-0.5 text-[0.55rem] font-semibold leading-none sm:text-[0.62rem] ${
                  isActive
                    ? "text-[var(--pf-brand-blue-hover)]"
                    : isUsed
                      ? "text-[var(--pf-text-muted)]/55"
                      : "text-[var(--pf-text-muted)]/80"
                }`}
              >
                {stateLabel}
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
            className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--pf-navy-deep)]/80 p-4 text-white"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeConfirmation();
            }}
            role="dialog"
          >
            <div className="w-full max-w-sm rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-5 shadow-2xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--pf-brand-blue)]">
                    Gameweek chip
                  </p>
                  <h2 className="mt-1 text-xl font-bold" id="chip-confirmation-title">
                    {chipToConfirm.label}
                  </h2>
                </div>
                <button
                  aria-label="Close chip confirmation"
                  className="rounded-md px-3 py-1 text-2xl text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                  onClick={closeConfirmation}
                  type="button"
                >
                  ×
                </button>
              </div>

              <p className="mt-4 text-sm leading-6 text-[var(--pf-text-muted)]">
                {chipToConfirm.description}
              </p>

              <div className="mt-4 rounded-md border border-[var(--pf-fantasy-yellow)]/35 bg-[var(--pf-fantasy-yellow)]/10 p-3 text-sm leading-5 text-[#ffe8a3]">
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
                  className="h-12 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-4 text-sm font-semibold text-[var(--pf-text)] hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                  onClick={closeConfirmation}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-12 w-full rounded-md bg-[var(--pf-brand-blue)] px-4 text-sm font-bold text-[var(--pf-navy-deep)] hover:bg-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)]"
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

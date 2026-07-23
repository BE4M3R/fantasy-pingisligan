import { selectGameweekChip } from "@/app/dashboard/actions";

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
  currentSelection,
  migrationMissing,
  selections,
  transfersLocked,
  upcomingGameweek,
}: {
  currentSelection: ChipSelection | null;
  migrationMissing: boolean;
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

  return (
    <section
      aria-labelledby="gameweek-chips-title"
      className="mt-5 border-t border-white/10 pt-5"
    >
      <h2
        className="text-sm font-bold text-sky-100"
        id="gameweek-chips-title"
      >
        Gameweek chips
      </h2>

      {migrationMissing ? (
        <div className="mt-3 rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          Run supabase/chips-migration.sql in Supabase to enable chips.
        </div>
      ) : null}

      {lockedChip ? (
        <div className="mt-3 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
          {getChipLabel(lockedChip.chip)} is locked in for this gameweek.
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {chips.map((chip) => {
          const isSelected = currentSelection?.chip === chip.value;
          const isUsed = usedChips.has(chip.value);
          const disabled =
            migrationMissing || transfersLocked || !upcomingGameweek || isUsed;
          const status = isSelected
            ? "Selected"
            : isUsed
              ? "Used"
              : "Available";

          return (
            <form
              action={selectGameweekChip}
              className="h-full"
              key={chip.value}
            >
              <input
                name="gameweek_id"
                type="hidden"
                value={upcomingGameweek?.id ?? ""}
              />
              <input name="chip" type="hidden" value={chip.value} />
              <button
                aria-label={`${chip.label}. ${
                  isUsed ? "Used this season." : chip.description
                } ${status}.`}
                aria-pressed={isSelected}
                className={`flex h-full min-h-24 w-full flex-col items-center rounded-md border px-2 py-3 text-center transition disabled:cursor-not-allowed sm:min-h-28 sm:px-3 ${
                  isSelected
                    ? "border-emerald-300/70 bg-emerald-300/15"
                    : `border-white/15 bg-white/5 hover:border-white/50 hover:bg-white/10 ${
                        disabled ? "opacity-45" : ""
                      }`
                }`}
                disabled={disabled || isSelected}
                title={chip.description}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    isSelected
                      ? "bg-emerald-300 text-sky-950"
                      : "bg-white/10 text-emerald-300"
                  }`}
                >
                  <ChipIcon chip={chip.value} />
                </span>
                <span className="mt-2 text-xs font-bold leading-tight text-white sm:text-sm">
                  <span className="sm:hidden">
                    {chip.value === "triple_captain"
                      ? "3× Captain"
                      : chip.label}
                  </span>
                  <span className="hidden sm:inline">{chip.label}</span>
                </span>
                <span className="mt-auto pt-1 text-[0.65rem] font-semibold leading-tight text-sky-100/55 sm:text-xs">
                  {status}
                </span>
              </button>
            </form>
          );
        })}
      </div>

      {currentSelection && !transfersLocked ? (
        <form action={selectGameweekChip} className="mt-3 text-right">
          <input
            name="gameweek_id"
            type="hidden"
            value={upcomingGameweek?.id ?? ""}
          />
          <button className="text-xs font-semibold text-sky-100/65 underline decoration-white/25 underline-offset-4 transition hover:text-white">
            Clear selected chip
          </button>
        </form>
      ) : null}
    </section>
  );
}

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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));
}

function getChipLabel(value: Chip) {
  return chips.find((chip) => chip.value === value)?.label ?? value;
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
    <section className="table-panel rounded-lg border p-5 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
            Chips
          </p>
          <h2 className="mt-2 text-xl font-black tracking-tight">Gameweek boost</h2>
          <p className="mt-2 text-sm leading-6 text-sky-100/65">
            Pick one chip before the next deadline. Each chip can be used once.
          </p>
        </div>
        {upcomingGameweek ? (
          <p className="text-sm text-sky-100/55 sm:text-right">
            {upcomingGameweek.name}
            <br />
            Locks {formatDateTime(upcomingGameweek.lock_at)}
          </p>
        ) : null}
      </div>

      {migrationMissing ? (
        <div className="mt-5 rounded-md border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          Run supabase/chips-migration.sql in Supabase to enable chips.
        </div>
      ) : null}

      {lockedChip ? (
        <div className="mt-5 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
          {getChipLabel(lockedChip.chip)} is locked in for this gameweek.
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {chips.map((chip) => {
          const isSelected = currentSelection?.chip === chip.value;
          const isUsed = usedChips.has(chip.value);
          const disabled =
            migrationMissing || transfersLocked || !upcomingGameweek || isUsed;

          return (
            <form action={selectGameweekChip} key={chip.value}>
              <input
                name="gameweek_id"
                type="hidden"
                value={upcomingGameweek?.id ?? ""}
              />
              <input name="chip" type="hidden" value={chip.value} />
              <button
                className={`h-full w-full rounded-md border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  isSelected
                    ? "border-emerald-300/70 bg-emerald-300/15"
                    : "border-white/15 bg-white/5 hover:border-white/50 hover:bg-white/10"
                }`}
                disabled={disabled || isSelected}
              >
                <span className="block font-bold text-white">{chip.label}</span>
                <span className="mt-2 block text-sm leading-5 text-sky-100/65">
                  {isUsed ? "Used this season." : chip.description}
                </span>
                {isSelected ? (
                  <span className="mt-3 inline-flex rounded-sm bg-emerald-300 px-2 py-1 text-xs font-black uppercase text-sky-950">
                    Selected
                  </span>
                ) : null}
              </button>
            </form>
          );
        })}
      </div>

      {currentSelection && !transfersLocked ? (
        <form action={selectGameweekChip} className="mt-4">
          <input
            name="gameweek_id"
            type="hidden"
            value={upcomingGameweek?.id ?? ""}
          />
          <button className="rounded-md border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-sky-50 transition hover:border-white/60 hover:bg-white/10">
            Clear selected chip
          </button>
        </form>
      ) : null}
    </section>
  );
}

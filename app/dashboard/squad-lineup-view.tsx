import type { ReactNode } from "react";

export const STARTER_SIZE = 4;
export const BENCH_SIZE = 2;
const COURT_POSITION_STYLE = {
  padding: "clamp(0.25rem, 1vw, 0.55rem) clamp(0.45rem, 1.5vw, 0.75rem)",
};
const BENCH_POSITION_STYLE = {
  padding: "0 clamp(0.45rem, 1.5vw, 0.75rem)",
};

export function SquadLineupView({
  title,
  compactTitle = false,
  starterCount,
  benchCount,
  renderStarter,
  renderBench,
  idPrefix = "",
  hidden = false,
  dimmed = false,
  className = "",
}: {
  title: string;
  compactTitle?: boolean;
  starterCount: number;
  benchCount: number;
  renderStarter: (index: number) => ReactNode;
  renderBench: (index: number) => ReactNode;
  idPrefix?: string;
  hidden?: boolean;
  dimmed?: boolean;
  className?: string;
}) {
  const starterTitleId = idPrefix ? `${idPrefix}-starting-lineup-title` : "starting-lineup-title";
  const benchTitleId = idPrefix ? `${idPrefix}-bench-title` : "bench-title";

  return (
    <div className={className}>
      <section
        aria-labelledby={starterTitleId}
        className={`mt-3 transition-opacity duration-150 ${hidden ? "hidden" : ""} ${dimmed ? "opacity-55" : ""}`}
      >
        <div className="mx-auto mb-2 flex max-w-xl items-end justify-between gap-4 px-1">
          <h2
            className={compactTitle ? "text-lg font-black" : "text-xl font-black tracking-tight sm:text-2xl"}
            id={starterTitleId}
          >
            {title}
          </h2>
          <span className="rounded-full border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] px-3 py-1 text-xs font-bold text-[var(--pf-text-muted)]">
            {starterCount} / {STARTER_SIZE}
          </span>
        </div>

        <div className="mx-auto w-full max-w-xl">
          <div className="relative w-full" style={{ paddingBottom: "66%" }}>
            <div
              aria-label="Table tennis starting lineup"
              className="absolute inset-0 grid grid-cols-2 grid-rows-2 overflow-visible rounded-md"
              role="group"
              style={{
                background: "var(--pf-table-blue)",
                border: "2px solid rgba(242, 246, 248, 0.68)",
                boxShadow: "0 18px 38px rgba(1, 23, 43, 0.3), inset 0 0 32px rgba(1, 33, 60, 0.16)",
                isolation: "isolate",
              }}
            >
              {Array.from({ length: STARTER_SIZE }, (_, index) => (
                <div
                  className="relative z-10 flex min-w-0 items-center justify-center"
                  key={`starter-slot-${index}`}
                  style={COURT_POSITION_STYLE}
                >
                  {renderStarter(index)}
                </div>
              ))}
              <div
                aria-hidden="true"
                style={{
                  backgroundColor: "rgba(242, 246, 248, 0.58)",
                  boxShadow: "0 0 1px rgba(255, 255, 255, 0.7)",
                  height: "2px",
                  left: 0,
                  pointerEvents: "none",
                  position: "absolute",
                  right: 0,
                  top: "50%",
                  transform: "translateY(-50%)",
                  zIndex: 5,
                }}
              />
              <div aria-hidden="true" className="squad-table-net pointer-events-none absolute z-20" />
            </div>
          </div>
        </div>
      </section>

      <section
        aria-labelledby={benchTitleId}
        className={`mx-auto mt-2 max-w-2xl transition-opacity duration-150 ${hidden ? "hidden" : ""} ${dimmed ? "opacity-55" : ""}`}
      >
        <div className="mb-2 flex items-center justify-between gap-4 px-1">
          <h2 className="text-lg font-black" id={benchTitleId}>Bench</h2>
          <span className="text-xs font-semibold text-[var(--pf-text-muted)]">{benchCount} / {BENCH_SIZE}</span>
        </div>
        <div className="grid min-w-0 grid-cols-2 px-1">
          {Array.from({ length: BENCH_SIZE }, (_, index) => (
            <div
              className="flex min-w-0 justify-center"
              key={`bench-slot-${index}`}
              style={BENCH_POSITION_STYLE}
            >
              {renderBench(index)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

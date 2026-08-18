const FIXTURE_RESULTS_URL =
  "https://sbtfeventsott.stupaevents.com/events/417/1118/2/7/7";

export function FixtureResultsLink({ className = "" }: { className?: string }) {
  return (
    <aside
      className={`table-panel rounded-lg border p-4 sm:flex sm:items-center sm:justify-between sm:gap-6 ${className}`}
    >
      <div>
        <h2 className="font-black text-[var(--pf-text)]">
          Official Pingisligan match results
        </h2>
      </div>
      <a
        className="mt-3 inline-flex shrink-0 items-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] px-4 py-2.5 text-sm font-bold text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue-hover)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue-hover)] sm:mt-0"
        href={FIXTURE_RESULTS_URL}
        rel="noreferrer"
        target="_blank"
      >
        Go here for fixture results
        <span aria-hidden="true" className="ml-2">
          ↗
        </span>
      </a>
    </aside>
  );
}

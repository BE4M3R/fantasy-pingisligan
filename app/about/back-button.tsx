"use client";

export function BackButton() {
  return (
    <button
      className="shrink-0 rounded-md border border-white/25 bg-white/5 px-3 py-2 text-sm font-bold text-[var(--pf-text)] transition hover:border-white/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy-deep)] sm:px-4"
      onClick={() => window.history.back()}
      type="button"
    >
      Go back
    </button>
  );
}

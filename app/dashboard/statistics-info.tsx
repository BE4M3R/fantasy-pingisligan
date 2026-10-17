"use client";

import { useId } from "react";

export function StatisticsInfo({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return <>
    <button aria-label={`About ${label}`} aria-haspopup="dialog" className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-md text-[var(--pf-text-muted)] hover:text-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]" popoverTarget={id} type="button">
      <span aria-hidden="true" className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[10px] font-bold leading-none">i</span>
    </button>
    <div aria-label={`About ${label}`} className="fixed left-1/2 top-1/2 m-0 w-[min(20rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-deep)] p-4 text-[var(--pf-text)] shadow-2xl backdrop:bg-[var(--pf-navy-deep)]/30" id={id} popover="auto" role="dialog">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold">{label}</h4>
        <button aria-label="Close information" className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-xl text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]" popoverTarget={id} popoverTargetAction="hide" type="button">×</button>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-[var(--pf-text-muted)]">{children}</div>
    </div>
  </>;
}

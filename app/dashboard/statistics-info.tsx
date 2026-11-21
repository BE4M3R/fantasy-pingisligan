"use client";

import { useId } from "react";
import { InfoPopoverIcon, InfoPopoverPanel } from "@/app/info-popover";

export function StatisticsInfo({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return <>
    <button aria-label={`About ${label}`} aria-haspopup="dialog" className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-md text-[var(--pf-text-muted)] hover:text-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]" popoverTarget={id} type="button">
      <InfoPopoverIcon />
    </button>
    <InfoPopoverPanel id={id} title={label} label={`About ${label}`}>{children}</InfoPopoverPanel>
  </>;
}

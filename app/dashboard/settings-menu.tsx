"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export function SettingsMenu({
  children,
  summary,
}: {
  children: ReactNode;
  summary: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node)) {
        details.open = false;
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, []);

  return (
    <details className="group relative ml-auto" ref={detailsRef}>
      <summary
        aria-label="Open settings"
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-brand-blue)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] sm:h-10 sm:w-10 [&::-webkit-details-marker]:hidden"
      >
        {summary}
      </summary>
      {children}
    </details>
  );
}

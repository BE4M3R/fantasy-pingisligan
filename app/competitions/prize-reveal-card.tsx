"use client";

import { useId, useRef, type MouseEvent, type ReactNode } from "react";
import { InfoPanelCloseButton, InfoPanelContent, infoPanelClassName } from "@/app/info-popover";

export function PrizeRevealCard({ gameweek, teaser, title, className, children }: {
  gameweek: string; teaser: string; title: string; className: string; children: ReactNode;
}) {
  const id = useId();
  const teaserId = `${id}-teaser`;
  const dialog = useRef<HTMLDialogElement>(null);

  function openReveal(event: MouseEvent<HTMLButtonElement>) {
    const panel = dialog.current;
    if (!panel || panel.open) return;

    const card = event.currentTarget.getBoundingClientRect();
    const clickX = event.detail ? event.clientX : card.left + card.width / 2;
    const clickY = event.detail ? event.clientY : card.top + card.height / 2;
    panel.showModal();

    const halfWidth = panel.offsetWidth / 2;
    const halfHeight = panel.offsetHeight / 2;
    const gutter = 12;
    const { clientWidth, clientHeight } = document.documentElement;
    const centerX = Math.min(clientWidth - halfWidth - gutter, Math.max(halfWidth + gutter, clickX));
    const centerY = Math.min(clientHeight - halfHeight - gutter, Math.max(halfHeight + gutter, clickY));
    panel.style.left = `${centerX}px`;
    panel.style.top = `${centerY}px`;

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      panel.style.transformOrigin = `${clickX - centerX + halfWidth}px ${clickY - centerY + halfHeight}px`;
      panel.animate([
        { opacity: 0, scale: "0.85" },
        { opacity: 1, scale: "1" },
      ], { duration: 160, easing: "ease-out" });
    }
  }

  return (
    <>
      <button
        aria-controls={id}
        aria-describedby={teaserId}
        aria-haspopup="dialog"
        aria-label={`Prize reveal for ${gameweek}`}
        className={className}
        onClick={openReveal}
        type="button"
      >
        <span className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere]">
          <span className="text-sm font-bold">{gameweek}</span>
          <span className="text-xs leading-snug text-[var(--pf-text-muted)]" id={teaserId}>{teaser}</span>
        </span>
        <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--pf-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      </button>
      <dialog
        aria-label={title}
        className={`${infoPanelClassName} max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain`}
        id={id}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        ref={dialog}
      >
        <InfoPanelContent title={title} closeButton={<InfoPanelCloseButton onClick={() => dialog.current?.close()} />}>
          {children}
        </InfoPanelContent>
      </dialog>
    </>
  );
}

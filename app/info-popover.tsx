import type { ComponentProps, ReactNode } from "react";

export const infoPanelClassName = "fixed left-1/2 top-1/2 m-0 w-[min(20rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-deep)] p-0 text-[var(--pf-text)] shadow-2xl backdrop:bg-[var(--pf-navy-deep)]/30";

export function InfoPopoverIcon() {
  return (
    <span aria-hidden="true" className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold leading-none">
      i
    </span>
  );
}

export function InfoPanelCloseButton(props: Pick<ComponentProps<"button">, "onClick" | "popoverTarget" | "popoverTargetAction">) {
  return (
    <button aria-label="Close information" className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-xl text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]" type="button" {...props}>×</button>
  );
}

export function InfoPanelContent({ title, closeButton, children }: {
  title: string; closeButton: ReactNode; children: ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold">{title}</h4>
        {closeButton}
      </div>
      <div className="mt-2 text-xs leading-relaxed text-[var(--pf-text-muted)]">{children}</div>
    </div>
  );
}

export function InfoPopoverPanel({ id, title, label = title, children }: {
  id: string; title: string; label?: string; children: ReactNode;
}) {
  return (
    <div aria-label={label} className={infoPanelClassName} id={id} popover="auto" role="dialog">
      <InfoPanelContent title={title} closeButton={<InfoPanelCloseButton popoverTarget={id} popoverTargetAction="hide" />}>
        {children}
      </InfoPanelContent>
    </div>
  );
}

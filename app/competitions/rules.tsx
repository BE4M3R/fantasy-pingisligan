import { SafeMarkdown } from "@/app/safe-markdown";
import { splitCompetitionRules } from "@/lib/competition-rules";

export function CompetitionRules({ body, title, version, conditions }: {
  body: string | null; title: string | null; version: number | null; conditions?: string;
}) {
  const sections = body && version ? splitCompetitionRules(body) : [];
  // Optional prize conditions stay with fulfilment information, never as a
  // second rules document or a separate visible prize-specific subsection.
  if (conditions) {
    const delivery = sections.find((section) => section.title === "Prize Delivery");
    if (delivery) delivery.body += `\n\n${conditions}`;
    else {
      const taxation = sections.findIndex((section) => section.title === "Taxation");
      sections.splice(taxation >= 0 ? taxation : sections.length, 0, { title: "Prize Delivery", body: conditions });
    }
  }
  return <>
    <p className="mt-2 text-sm leading-6 text-[var(--pf-text-muted)]">{body && version
      ? "Read about participation, winner selection, claiming, delivery and taxation."
      : "Competition terms are being finalised. Full participation and prize information will be published before awards begin."}</p>
    {body && version ? <p className="mt-2 text-xs text-[var(--pf-text-muted)]">{title} · Version {version}</p> : null}
    <div className="mt-3 divide-y divide-[var(--pf-card-border)]">
      {sections.map((section) => <details key={section.title} className="group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-semibold text-[var(--pf-text)] focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pf-brand-blue-hover)] [&::-webkit-details-marker]:hidden">
          <span>{section.title}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-[var(--pf-brand-blue-hover)] group-open:rotate-180"><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <div className="pb-4"><SafeMarkdown>{section.body}</SafeMarkdown></div>
      </details>)}
    </div>
  </>;
}

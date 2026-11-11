import { SafeMarkdown } from "@/app/safe-markdown";
import { splitCompetitionRules } from "@/lib/competition-rules";

export function CompetitionRules({ body }: { body: string }) {
  const sections = splitCompetitionRules(body);
  return <div className="mt-3 divide-y divide-[var(--pf-card-border)]">
      {sections.map((section) => <details key={section.title} className="group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-semibold text-[var(--pf-text)] focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pf-brand-blue-hover)] [&::-webkit-details-marker]:hidden">
          <span>{section.title}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-[var(--pf-brand-blue-hover)] group-open:rotate-180"><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <div className="pb-4"><SafeMarkdown>{section.body}</SafeMarkdown></div>
      </details>)}
    </div>;
}

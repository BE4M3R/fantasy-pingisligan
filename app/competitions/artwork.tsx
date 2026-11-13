"use client";

import { useState } from "react";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { safeAnnouncementUrl } from "@/lib/announcements";

export function CompetitionArtwork({ src, alt, compact = false, productUrl }: { src?: string; alt: string; compact?: boolean; productUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  const safeUrl = safeAnnouncementUrl(productUrl);
  const href = safeUrl?.startsWith("https://") ? safeUrl : undefined;
  const content = <>
    <div className={`flex items-center justify-center ${compact ? "h-16 w-16 shrink-0 p-1" : "h-44 p-3 sm:h-72 sm:p-5"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onError={() => setFailed(true)} ref={(image) => {
        if (image?.complete && image.naturalWidth === 0) setFailed(true);
      }} className="max-h-full max-w-full object-contain" />
    </div>
    {href ? <span className="flex items-center justify-center gap-1.5 border-t border-[var(--pf-card-border)] px-3 py-2.5 text-xs font-semibold text-[var(--pf-brand-blue-hover)]">
      View product <span className="sr-only">(opens in a new tab)</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M14 3h7v7m0-7L10 14m0-11H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></svg>
    </span> : null}
  </>;
  const className = "block overflow-hidden rounded-xl bg-[var(--pf-navy-elevated)]";
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => trackAnalyticsEvent("Sponsor Link Clicked")} className={`${className} transition hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pf-logo-gold)]`}>{content}</a>
    : <div className={className}>{content}</div>;
}

"use client";

import Link from "next/link";
import Markdown from "react-markdown";
import { announcementCategoryLabels, type Announcement, safeAnnouncementUrl } from "@/lib/announcements";
import { AnnouncementCategoryIcon } from "./category-icon";

export function AnnouncementContent({ announcement, imageUrl, onFollowLink }: { announcement: Announcement; imageUrl?: string; onFollowLink?: (url: string) => void }) {
  const cta = safeAnnouncementUrl(announcement.cta_url);
  function follow(event: React.MouseEvent, url: string) {
    if (onFollowLink && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      onFollowLink(url);
    }
  }
  return (
    <article className="min-w-0 space-y-4 break-words">
      <header className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--pf-brand-blue-hover)]">
            <AnnouncementCategoryIcon category={announcement.category} className="h-4 w-4" />
            {announcementCategoryLabels[announcement.category]}
          </span>
          <time className="text-[11px] text-[var(--pf-text-muted)]" dateTime={announcement.publish_at}>
            {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Stockholm" }).format(new Date(announcement.publish_at))}
          </time>
        </div>
        <h2 className="text-xl font-bold leading-7 tracking-tight sm:text-2xl sm:leading-8" id="announcement-title">{announcement.title}</h2>
        {announcement.priority === "high" ? <span className="inline-block rounded bg-amber-400/15 px-2 py-1 text-[10px] font-bold text-amber-200">High priority</span> : null}
      </header>
      {imageUrl ? (
        <div className="flex items-center justify-center rounded-xl bg-[var(--pf-navy-elevated)] p-3">
          {/* Retain the file's own background; transparent artwork uses the surrounding navy. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={announcement.image_alt ?? ""} className="block h-auto w-auto max-w-full max-h-[min(11rem,24dvh)] rounded-md object-contain sm:max-h-44" src={imageUrl} />
        </div>
      ) : null}
      <div className="space-y-3 text-sm leading-6 text-[var(--pf-text)] [&_li]:ml-5 [&_ol]:list-decimal [&_strong]:font-bold [&_ul]:list-disc">
        <Markdown
          skipHtml
          allowedElements={["p", "strong", "em", "ul", "ol", "li", "a", "br"]}
          unwrapDisallowed
          urlTransform={(url) => safeAnnouncementUrl(url) ?? ""}
          components={{ a: ({ href, children }) => {
            const safe = safeAnnouncementUrl(href);
            return safe ? <Link className="font-semibold text-[var(--pf-brand-blue-hover)] underline underline-offset-2" href={safe} onClick={(event) => follow(event, safe)}>{children}</Link> : <span>{children}</span>;
          } }}
        >{announcement.body}</Markdown>
      </div>
      {cta && announcement.cta_label ? <Link className="inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--pf-brand-blue)] px-4 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] hover:bg-[var(--pf-brand-blue-hover)]" href={cta} onClick={(event) => follow(event, cta)}>{announcement.cta_label}</Link> : null}
    </article>
  );
}

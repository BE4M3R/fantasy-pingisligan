"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SafeMarkdown } from "@/app/safe-markdown";
import { type Announcement, safeAnnouncementUrl } from "@/lib/announcements";
import { SITE_URL } from "@/lib/seo";
import { AnnouncementMetadata } from "./metadata";

const productionOrigins = new Set([SITE_URL, "https://pingisliganfantasy.se"]);

function localAnnouncementHref(href: string) {
  if (href.startsWith("/")) return href;

  const { origin, pathname, search, hash } = new URL(href);
  const currentOrigin = window.location.origin;
  // Keep links between the two production domains on the installed origin.
  const sameApp = origin === currentOrigin ||
    (productionOrigins.has(origin) && productionOrigins.has(currentOrigin));

  return sameApp && !pathname.startsWith("//") ? `${pathname}${search}${hash}` : href;
}

export function AnnouncementContent({ announcement, imageUrl, onFollowLink, showMetadata = true }: { announcement: Announcement; imageUrl?: string; onFollowLink?: (url: string) => void; showMetadata?: boolean }) {
  const router = useRouter();
  const cta = safeAnnouncementUrl(announcement.cta_url);

  function follow(href: string) {
    const destination = localAnnouncementHref(href);
    if (onFollowLink) {
      onFollowLink(destination);
      return true;
    }

    if (destination === href) return false;
    router.push(destination);
    return true;
  }
  return (
    <article className="min-w-0 space-y-4 break-words">
      <header className="space-y-2.5">
        {showMetadata ? <AnnouncementMetadata announcement={announcement} /> : null}
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
      <SafeMarkdown onFollowLink={follow}>{announcement.body}</SafeMarkdown>
      {cta && announcement.cta_label ? (
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--pf-brand-blue)] px-4 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] hover:bg-[var(--pf-brand-blue-hover)]"
          href={cta}
          onClick={(event) => {
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && follow(cta)) {
              event.preventDefault();
            }
          }}
        >
          {announcement.cta_label}
        </Link>
      ) : null}
    </article>
  );
}

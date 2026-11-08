import { announcementCategoryLabels, type Announcement } from "@/lib/announcements";
import { AnnouncementCategoryIcon } from "./category-icon";

export function AnnouncementMetadata({ announcement, compact = false }: { announcement: Announcement; compact?: boolean }) {
  return <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "justify-between"}`}>
    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--pf-brand-blue-hover)]">
      <AnnouncementCategoryIcon category={announcement.category} className="h-4 w-4" />
      {announcementCategoryLabels[announcement.category]}
    </span>
    <time className="whitespace-nowrap text-[11px] text-[var(--pf-text-muted)]" dateTime={announcement.publish_at}>
      {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Stockholm" }).format(new Date(announcement.publish_at))}
    </time>
  </div>;
}

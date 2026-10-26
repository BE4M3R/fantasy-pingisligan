import type { Announcement } from "@/lib/announcements";

const paths = {
  news: "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5",
  sponsor: "M4 9h16v4H4z M6 13v8h12v-8 M12 9v12 M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z",
};

export function AnnouncementCategoryIcon({ category, className = "h-5 w-5" }: { category: Announcement["category"]; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d={paths[category === "sponsor" ? "sponsor" : "news"]} />
    </svg>
  );
}

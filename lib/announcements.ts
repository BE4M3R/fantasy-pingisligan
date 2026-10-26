export type AnnouncementCandidate = {
  id: string;
  priority: "normal" | "high";
  publish_at: string;
};

export type AnnouncementSummary = {
  unread_count: number;
  pending: AnnouncementCandidate[];
  snoozed_until: string | null;
  checked_at: string;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  category: "news" | "update" | "sponsor" | "important";
  priority: "normal" | "high";
  publish_at: string;
  image_path: string | null;
  image_alt: string | null;
  cta_label: string | null;
  cta_url: string | null;
};

export const announcementFields = "id, title, body, category, priority, publish_at, image_path, image_alt, cta_label, cta_url";

export const announcementCategoryLabels = {
  // Existing categories remain readable without a data migration; publish News or Sponsor.
  news: "News", update: "News", sponsor: "Sponsored", important: "News",
};

// A plain-text excerpt for the inbox; full Markdown rendering stays in the detail view.
export function announcementPreview(body: string) {
  const text = body.replace(/<[^>]*>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#~]/g, "").replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 137).trimEnd()}…` : text;
}

// Use the database's clock so a phone's timezone/clock cannot change snooze eligibility.
export function popupCandidates(summary: AnnouncementSummary) {
  const snoozed = Boolean(summary.snoozed_until &&
    Date.parse(summary.snoozed_until) > Date.parse(summary.checked_at));
  return summary.pending.filter((item) => item.priority === "high" || !snoozed);
}

export function safeAnnouncementUrl(value: string | null | undefined): string | undefined {
  if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

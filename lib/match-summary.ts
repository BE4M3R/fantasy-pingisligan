export type MatchSummary = {
  id: string;
  stupa_match_id: number | null;
  home_team_name: string | null;
  away_team_name: string | null;
  starts_at: string | null;
  status: string;
  home_score: number;
  away_score: number;
  source_updated_at: string | null;
  stream_url?: string | null;
};

export function matchState(match: MatchSummary, now: number) {
  const status = match.status.toLowerCase();
  if (["cancelled", "canceled"].includes(status)) return "Cancelled";
  if (status === "postponed") return "Postponed";
  if (["scored", "completed", "finished"].includes(status) ||
    match.home_score >= 5 || match.away_score >= 5) return "Final";
  if (["live", "in_progress", "in progress", "ongoing", "started"].includes(status) ||
    match.home_score + match.away_score > 0) return "Live";
  if (match.starts_at && Date.parse(match.starts_at) <= now) {
    return "Live";
  }
  return "Upcoming";
}

export function safeStreamUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

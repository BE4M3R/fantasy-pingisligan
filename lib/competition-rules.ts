export const competitionRuleSections = [
  "Participation",
  "Winner Selection",
  "Winner Announcement & Claiming",
  "Prize Delivery",
  "Taxation",
] as const;

// Keep one Supabase Markdown body per approved version. Headings only organize
// its presentation; they never change eligibility, scoring or publication.
export function splitCompetitionRules(markdown: string) {
  const sections = competitionRuleSections.map((title) => ({ title, body: "" }));
  let current = 0;
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? undefined : marker;
      sections[current].body += `${line}\n`;
      continue;
    }
    const heading = !fence ? /^ {0,3}##\s+(.+?)(?:\s+#+)?\s*$/.exec(line)?.[1] : undefined;
    const normalized = heading?.toLowerCase().replace(/&/g, "and").replace(/^how the winner is selected$/, "winner selection");
    const index = sections.findIndex(({ title }) => title.toLowerCase().replace(/&/g, "and") === normalized);
    if (index >= 0) current = index;
    else sections[current].body += `${line}\n`;
  }
  // Legacy text, introductions and unrecognized headings stay intact in the
  // current section. Empty categories are not filled with invented conditions.
  return sections.map((section) => ({ ...section, body: section.body.trim() })).filter(({ body }) => body);
}

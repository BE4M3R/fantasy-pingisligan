import "server-only";
import { createPublicClient } from "@/lib/supabase/public";

export type PublishedCompetitionRules = {
  kind: "gameweek" | "season";
  version: number;
  title: string;
  body: string;
};

export async function getPublishedCompetitionRules() {
  // The database returns at most one approved policy per enabled kind, without
  // requiring a prize binding. Fresh reads make new approvals visible on reload.
  const { data, error } = await createPublicClient({ fresh: true }).rpc("get_current_competition_rules");
  return { rules: (data ?? []) as PublishedCompetitionRules[], error: Boolean(error) };
}

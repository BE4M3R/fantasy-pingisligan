import { canonicalClubName, normalizeClubName } from "../lib/clubs.ts";

export function findExistingClub(clubs, name) {
  const key = normalizeClubName(canonicalClubName(name));
  const matches = clubs.filter((club) =>
    normalizeClubName(canonicalClubName(club.name)) === key);
  if (matches.length > 1) {
    throw new Error(`Multiple database clubs resolve to ${name}; reconcile them before importing.`);
  }
  return matches[0] ?? null;
}

export async function getOrCreateClubId(supabase, clubs, sourceName) {
  if (!sourceName) return null;
  const name = canonicalClubName(sourceName);
  const existing = findExistingClub(clubs, name);
  if (existing) {
    if (existing.name !== name) {
      const { error } = await supabase.from("clubs").update({ name }).eq("id", existing.id);
      if (error) throw new Error(`Could not rename club ${name}: ${error.message}`);
      existing.name = name;
    }
    return existing.id;
  }
  const { data, error } = await supabase.from("clubs")
    .upsert({ name }, { onConflict: "name" }).select("id, name").single();
  if (error) throw new Error(`Could not save club ${name}: ${error.message}`);
  clubs.push(data);
  return data.id;
}

"use server";

import { createClient } from "@/lib/supabase/server";

export async function recordAnnouncementInteraction(id: string, dismiss = false) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || typeof dismiss !== "boolean") {
    return { error: "Invalid announcement." };
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return { error: "Please sign in again." };
  const { error } = await supabase.rpc("record_announcement_interaction", {
    p_announcement_id: id, p_dismiss: dismiss,
  });
  return { error: error ? "Could not save. Please try again." : null };
}

export async function snoozeAnnouncements() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return { error: "Please sign in again." };
  const { data, error } = await supabase.rpc("snooze_announcements");
  return { error: error ? "Could not save the pause. Please try again." : null,
    snoozedUntil: error ? null : data as string };
}

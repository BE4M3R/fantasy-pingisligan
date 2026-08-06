"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const MAX_LEAGUE_NAME_LENGTH = 50;
const INVITE_CODE_LENGTH = 8;

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function leaderboardMessage(message: string): never {
  redirect(`/dashboard/leaderboard?message=${encodeURIComponent(message)}`);
}

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims.sub) {
    redirect("/login");
  }

  return supabase;
}

function migrationMessage(errorMessage: string) {
  return errorMessage.includes("Could not find the function") ||
    errorMessage.includes("does not exist")
    ? "Database migration needed: run supabase/private-leaderboards-migration.sql."
    : errorMessage;
}

export async function createPrivateLeaderboard(formData: FormData) {
  const name = getString(formData, "name").replace(/\s+/g, " ");

  if (!name) {
    leaderboardMessage("Leaderboard name cannot be empty.");
  }

  if (name.length > MAX_LEAGUE_NAME_LENGTH) {
    leaderboardMessage(
      `Leaderboard name can be at most ${MAX_LEAGUE_NAME_LENGTH} characters.`,
    );
  }

  const supabase = await getAuthenticatedClient();
  const { data, error } = await supabase.rpc("create_private_league", {
    p_name: name,
  });

  if (error) {
    leaderboardMessage(migrationMessage(error.message));
  }

  revalidatePath("/dashboard/leaderboard");
  redirect(
    `/dashboard/leaderboard?league=${encodeURIComponent(String(data))}&message=${encodeURIComponent("Private leaderboard created. Share the invitation with your friends.")}`,
  );
}

export async function joinPrivateLeaderboard(formData: FormData) {
  const inviteCode = getString(formData, "invite_code")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

  if (inviteCode.length !== INVITE_CODE_LENGTH) {
    leaderboardMessage("Enter the 8-character invitation code.");
  }

  const supabase = await getAuthenticatedClient();
  const { data, error } = await supabase.rpc("join_private_league", {
    p_invite_code: inviteCode,
  });

  if (error) {
    leaderboardMessage(migrationMessage(error.message));
  }

  revalidatePath("/dashboard/leaderboard");
  redirect(
    `/dashboard/leaderboard?league=${encodeURIComponent(String(data))}&message=${encodeURIComponent("You joined the private leaderboard.")}`,
  );
}

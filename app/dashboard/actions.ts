"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const SQUAD_SIZE = 6;
const STARTER_SIZE = 4;
const BENCH_SIZE = 2;
const DEFAULT_BUDGET = 100000000;
const MAX_TEAM_NAME_LENGTH = 40;
const VALID_POSITIONS = ["starter", "bench"] as const;

type SquadPosition = (typeof VALID_POSITIONS)[number];

type TeamPlayer = {
  players: { price: number | string } | { price: number | string }[] | null;
};

type SquadPlayerRow = TeamPlayer & {
  is_captain: boolean;
  player_id: string;
  position: SquadPosition;
};

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function dashboardMessage(message: string): never {
  redirect(`/dashboard?message=${encodeURIComponent(message)}`);
}

async function getUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, userId: user.id };
}

async function getOrCreateFantasyTeam(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: existingTeam, error: existingError } = await supabase
    .from("fantasy_teams")
    .select("id, budget")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    dashboardMessage(existingError.message);
  }

  if (existingTeam) {
    return existingTeam;
  }

  const { data: createdTeam, error: createdError } = await supabase
    .from("fantasy_teams")
    .insert({
      user_id: userId,
      name: "My team",
      budget: DEFAULT_BUDGET,
    })
    .select("id, budget")
    .single();

  if (createdError) {
    if (createdError.message.includes("numeric field overflow")) {
      dashboardMessage(
        "Database migration needed: run supabase/player-import-migration.sql again to update fantasy team budgets.",
      );
    }

    dashboardMessage(createdError.message);
  }

  return createdTeam;
}

function getNestedPrice(row: TeamPlayer) {
  const player = Array.isArray(row.players) ? row.players[0] : row.players;
  return Number(player?.price ?? 0);
}

function getPositionCount(squad: SquadPlayerRow[], position: SquadPosition) {
  return squad.filter((row) => row.position === position).length;
}

async function assertTransfersOpen(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("current_transfer_lock");

  if (error) {
    dashboardMessage(error.message);
  }

  const lock = Array.isArray(data) ? data[0] : data;

  if (lock?.is_locked) {
    dashboardMessage(
      `${lock.gameweek_name ?? "This gameweek"} is locked. Squad changes reopen after the round finishes.`,
    );
  }
}

export async function addPlayerToTeam(formData: FormData) {
  const playerId = getString(formData, "player_id");

  if (!playerId) {
    dashboardMessage("Missing player.");
  }

  const { supabase, userId } = await getUserId();
  await assertTransfersOpen(supabase);
  const team = await getOrCreateFantasyTeam(supabase, userId);

  const { data: player, error: playerError } = await supabase
    .from("players")
    .select("id, price")
    .eq("id", playerId)
    .maybeSingle();

  if (playerError || !player) {
    dashboardMessage(playerError?.message ?? "Player not found.");
  }

  const { data: squadRows, error: squadError } = await supabase
    .from("fantasy_team_players")
    .select("player_id, position, is_captain, players(price)")
    .eq("fantasy_team_id", team.id);

  if (squadError) {
    dashboardMessage(squadError.message);
  }

  const squad = (squadRows ?? []) as SquadPlayerRow[];

  if (squad.some((row) => row.player_id === player.id)) {
    dashboardMessage("That player is already in your squad.");
  }

  if (squad.length >= SQUAD_SIZE) {
    dashboardMessage("Your squad already has six players.");
  }

  const usedBudget = squad.reduce((total, row) => total + getNestedPrice(row), 0);
  const playerPrice = Number(player.price);
  const budget = Number(team.budget);

  if (usedBudget + playerPrice > budget) {
    dashboardMessage("That transfer would exceed your budget.");
  }

  const { error: insertError } = await supabase
    .from("fantasy_team_players")
    .insert({
      fantasy_team_id: team.id,
      is_captain: squad.length === 0,
      player_id: player.id,
      position:
        getPositionCount(squad, "starter") < STARTER_SIZE
          ? "starter"
          : "bench",
    });

  if (insertError) {
    dashboardMessage(insertError.message);
  }

  revalidatePath("/dashboard");
}

export async function updateTeamName(formData: FormData) {
  const name = getString(formData, "team_name").replace(/\s+/g, " ");

  if (!name) {
    dashboardMessage("Team name cannot be empty.");
  }

  if (name.length > MAX_TEAM_NAME_LENGTH) {
    dashboardMessage(`Team name can be at most ${MAX_TEAM_NAME_LENGTH} characters.`);
  }

  const { supabase, userId } = await getUserId();
  const team = await getOrCreateFantasyTeam(supabase, userId);

  const { error } = await supabase
    .from("fantasy_teams")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", team.id)
    .eq("user_id", userId);

  if (error) {
    dashboardMessage(error.message);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/leaderboard");
}

export async function deleteAccount() {
  const { supabase } = await getUserId();

  const { error } = await supabase.rpc("delete_current_user");

  if (error) {
    dashboardMessage(error.message);
  }

  redirect("/");
}

export async function setPlayerPosition(formData: FormData) {
  const playerId = getString(formData, "player_id");
  const position = getString(formData, "position") as SquadPosition;

  if (!playerId || !VALID_POSITIONS.includes(position)) {
    dashboardMessage("Missing squad position.");
  }

  const { supabase, userId } = await getUserId();
  await assertTransfersOpen(supabase);
  const team = await getOrCreateFantasyTeam(supabase, userId);

  const { data: squadRows, error: squadError } = await supabase
    .from("fantasy_team_players")
    .select("player_id, position, is_captain, players(price)")
    .eq("fantasy_team_id", team.id);

  if (squadError) {
    dashboardMessage(squadError.message);
  }

  const squad = (squadRows ?? []) as SquadPlayerRow[];
  const currentPlayer = squad.find((row) => row.player_id === playerId);

  if (!currentPlayer) {
    dashboardMessage("Player not found in your squad.");
  }

  if (currentPlayer.position === position) {
    revalidatePath("/dashboard");
    return;
  }

  const positionLimit = position === "starter" ? STARTER_SIZE : BENCH_SIZE;

  if (getPositionCount(squad, position) >= positionLimit) {
    dashboardMessage(
      position === "starter"
        ? "You can only have four main players."
        : "You can only have two bench players.",
    );
  }

  const { error } = await supabase
    .from("fantasy_team_players")
    .update({ position })
    .eq("fantasy_team_id", team.id)
    .eq("player_id", playerId);

  if (error) {
    dashboardMessage(error.message);
  }

  revalidatePath("/dashboard");
}

export async function setTeamCaptain(formData: FormData) {
  const playerId = getString(formData, "player_id");

  if (!playerId) {
    dashboardMessage("Missing captain.");
  }

  const { supabase, userId } = await getUserId();
  await assertTransfersOpen(supabase);
  const team = await getOrCreateFantasyTeam(supabase, userId);

  const { data: squadPlayer, error: squadPlayerError } = await supabase
    .from("fantasy_team_players")
    .select("player_id")
    .eq("fantasy_team_id", team.id)
    .eq("player_id", playerId)
    .maybeSingle();

  if (squadPlayerError || !squadPlayer) {
    dashboardMessage(squadPlayerError?.message ?? "Player not found in your squad.");
  }

  const { error: clearError } = await supabase
    .from("fantasy_team_players")
    .update({ is_captain: false })
    .eq("fantasy_team_id", team.id);

  if (clearError) {
    dashboardMessage(clearError.message);
  }

  const { error: captainError } = await supabase
    .from("fantasy_team_players")
    .update({ is_captain: true })
    .eq("fantasy_team_id", team.id)
    .eq("player_id", playerId);

  if (captainError) {
    dashboardMessage(captainError.message);
  }

  revalidatePath("/dashboard");
}

export async function removePlayerFromTeam(formData: FormData) {
  const playerId = getString(formData, "player_id");

  if (!playerId) {
    dashboardMessage("Missing player.");
  }

  const { supabase, userId } = await getUserId();
  await assertTransfersOpen(supabase);
  const team = await getOrCreateFantasyTeam(supabase, userId);

  const { data: removingPlayer, error: removingPlayerError } = await supabase
    .from("fantasy_team_players")
    .select("is_captain")
    .eq("fantasy_team_id", team.id)
    .eq("player_id", playerId)
    .maybeSingle();

  if (removingPlayerError) {
    dashboardMessage(removingPlayerError.message);
  }

  const { error } = await supabase
    .from("fantasy_team_players")
    .delete()
    .eq("fantasy_team_id", team.id)
    .eq("player_id", playerId);

  if (error) {
    dashboardMessage(error.message);
  }

  if (removingPlayer?.is_captain) {
    const { data: nextCaptain } = await supabase
      .from("fantasy_team_players")
      .select("player_id")
      .eq("fantasy_team_id", team.id)
      .limit(1)
      .maybeSingle();

    if (nextCaptain) {
      await supabase
        .from("fantasy_team_players")
        .update({ is_captain: true })
        .eq("fantasy_team_id", team.id)
        .eq("player_id", nextCaptain.player_id);
    }
  }

  revalidatePath("/dashboard");
}

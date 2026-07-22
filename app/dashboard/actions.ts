"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const STARTER_SIZE = 4;
const BENCH_SIZE = 2;
const SQUAD_SIZE = STARTER_SIZE + BENCH_SIZE;
const DEFAULT_BUDGET = 100000000;
const MAX_TEAM_NAME_LENGTH = 40;
const MAX_PLAYERS_PER_CLUB = 2;

type SquadPosition = "starter" | "bench";
type Chip = "wildcard" | "triple_captain" | "bench_boost";

type TeamPlayer = {
  players:
    | { club_id: string | null; price: number | string }
    | { club_id: string | null; price: number | string }[]
    | null;
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

function isChip(value: string): value is Chip {
  return value === "wildcard" || value === "triple_captain" || value === "bench_boost";
}

async function getUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims?.sub) {
    redirect("/login");
  }

  return { supabase, userId: claims.sub };
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

function getNestedClubId(row: TeamPlayer) {
  const player = Array.isArray(row.players) ? row.players[0] : row.players;
  return player?.club_id ?? null;
}

function hasReachedClubLimit(
  squad: SquadPlayerRow[],
  clubId: string | null,
  excludedPlayerId?: string,
) {
  if (!clubId) {
    return false;
  }

  return squad.filter(
    (row) => row.player_id !== excludedPlayerId && getNestedClubId(row) === clubId,
  ).length >= MAX_PLAYERS_PER_CLUB;
}

function getPositionCount(squad: SquadPlayerRow[], position: SquadPosition) {
  return squad.filter((row) => row.position === position).length;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "after the round finishes";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));
}

async function assertTransfersOpen(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("current_transfer_lock");

  if (error) {
    dashboardMessage(error.message);
  }

  const lock = Array.isArray(data) ? data[0] : data;

  if (lock?.is_locked) {
    dashboardMessage(
      `The transfer window is closed for ${lock.gameweek_name ?? "this gameweek"}. It reopens ${formatDateTime(lock.unlock_at)}.`,
    );
  }
}

export async function addPlayerToTeam(formData: FormData) {
  const playerId = getString(formData, "player_id");
  const requestedPosition = getString(formData, "position");

  if (!playerId) {
    dashboardMessage("Missing player.");
  }

  const { supabase, userId } = await getUserId();
  await assertTransfersOpen(supabase);
  const team = await getOrCreateFantasyTeam(supabase, userId);

  const { data: player, error: playerError } = await supabase
    .from("players")
    .select("id, price, club_id")
    .eq("id", playerId)
    .maybeSingle();

  if (playerError || !player) {
    dashboardMessage(playerError?.message ?? "Player not found.");
  }

  const { data: squadRows, error: squadError } = await supabase
    .from("fantasy_team_players")
    .select("player_id, position, is_captain, players(price, club_id)")
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

  if (hasReachedClubLimit(squad, player.club_id)) {
    dashboardMessage("You can select a maximum of two players from the same club.");
  }

  const position: SquadPosition =
    requestedPosition === "bench" || requestedPosition === "starter"
      ? requestedPosition
      : getPositionCount(squad, "starter") < STARTER_SIZE
        ? "starter"
        : "bench";
  const positionLimit = position === "starter" ? STARTER_SIZE : BENCH_SIZE;

  if (getPositionCount(squad, position) >= positionLimit) {
    dashboardMessage(`All ${position === "starter" ? "main" : "bench"} slots are already filled.`);
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
      position,
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
    .update({
      name,
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", team.id)
    .eq("user_id", userId);

  if (error) {
    dashboardMessage(error.message);
  }

  revalidatePath("/dashboard", "layout");
}

export async function selectGameweekChip(formData: FormData) {
  const gameweekId = getString(formData, "gameweek_id");
  const chip = getString(formData, "chip");

  if (!gameweekId) {
    dashboardMessage("No upcoming gameweek found.");
  }

  if (chip && !isChip(chip)) {
    dashboardMessage("Choose a valid chip.");
  }

  const { supabase, userId } = await getUserId();
  await assertTransfersOpen(supabase);
  const team = await getOrCreateFantasyTeam(supabase, userId);

  const { data: gameweek, error: gameweekError } = await supabase
    .from("fantasy_gameweeks")
    .select("id, lock_at")
    .eq("id", gameweekId)
    .gt("lock_at", new Date().toISOString())
    .maybeSingle();

  if (gameweekError) {
    dashboardMessage(gameweekError.message);
  }

  if (!gameweek) {
    dashboardMessage("That gameweek is already locked.");
  }

  if (!chip) {
    const { error } = await supabase
      .from("fantasy_team_chip_selections")
      .delete()
      .eq("fantasy_team_id", team.id)
      .eq("fantasy_gameweek_id", gameweek.id)
      .is("locked_at", null);

    if (error) {
      dashboardMessage(
        error.message.includes("fantasy_team_chip_selections")
          ? "Database migration needed: run supabase/chips-migration.sql to enable chips."
          : error.message,
      );
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/overview");
    return;
  }

  const { data: usedChip, error: usedChipError } = await supabase
    .from("fantasy_team_chip_selections")
    .select("chip")
    .eq("fantasy_team_id", team.id)
    .eq("chip", chip)
    .not("locked_at", "is", null)
    .maybeSingle();

  if (usedChipError) {
    dashboardMessage(
      usedChipError.message.includes("fantasy_team_chip_selections")
        ? "Database migration needed: run supabase/chips-migration.sql to enable chips."
        : usedChipError.message,
    );
  }

  if (usedChip) {
    dashboardMessage("That chip has already been used this season.");
  }

  const { error } = await supabase
    .from("fantasy_team_chip_selections")
    .upsert(
      {
        fantasy_team_id: team.id,
        fantasy_gameweek_id: gameweek.id,
        chip,
        selected_at: new Date().toISOString(),
      },
      { onConflict: "fantasy_team_id,fantasy_gameweek_id" },
    );

  if (error) {
    dashboardMessage(error.message);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/overview");
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
  void formData;
  dashboardMessage("Use a player swap to change your main players and bench.");
}

export async function swapSquadPlayers(formData: FormData) {
  const playerId = getString(formData, "player_id");
  const targetPlayerId = getString(formData, "target_player_id");

  if (!playerId || !targetPlayerId || playerId === targetPlayerId) {
    dashboardMessage("Choose two different squad players to swap.");
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

  if (squad.length !== SQUAD_SIZE) {
    dashboardMessage("Fill your six-player squad before swapping positions.");
  }

  const player = squad.find((row) => row.player_id === playerId);
  const targetPlayer = squad.find((row) => row.player_id === targetPlayerId);

  if (!player || !targetPlayer) {
    dashboardMessage("Both players must be in your squad.");
  }

  if (player.position === targetPlayer.position) {
    dashboardMessage("Choose one main player and one bench player to swap.");
  }

  const { error: firstError } = await supabase
    .from("fantasy_team_players")
    .update({ position: targetPlayer.position })
    .eq("fantasy_team_id", team.id)
    .eq("player_id", player.player_id);

  if (firstError) {
    dashboardMessage(firstError.message);
  }

  const { error: secondError } = await supabase
    .from("fantasy_team_players")
    .update({ position: player.position })
    .eq("fantasy_team_id", team.id)
    .eq("player_id", targetPlayer.player_id);

  if (secondError) {
    await supabase
      .from("fantasy_team_players")
      .update({ position: player.position })
      .eq("fantasy_team_id", team.id)
      .eq("player_id", player.player_id);

    dashboardMessage(secondError.message);
  }

  revalidatePath("/dashboard");
}

export async function swapPlayerIntoTeam(formData: FormData) {
  const incomingPlayerId = getString(formData, "player_id");
  const outgoingPlayerId = getString(formData, "outgoing_player_id");

  if (!incomingPlayerId || !outgoingPlayerId || incomingPlayerId === outgoingPlayerId) {
    dashboardMessage("Choose one squad player to swap out.");
  }

  const { supabase, userId } = await getUserId();
  await assertTransfersOpen(supabase);
  const team = await getOrCreateFantasyTeam(supabase, userId);

  const { data: incomingPlayer, error: incomingError } = await supabase
    .from("players")
    .select("id, price, club_id")
    .eq("id", incomingPlayerId)
    .maybeSingle();

  if (incomingError || !incomingPlayer) {
    dashboardMessage(incomingError?.message ?? "Player not found.");
  }

  const { data: squadRows, error: squadError } = await supabase
    .from("fantasy_team_players")
    .select("player_id, position, is_captain, players(price, club_id)")
    .eq("fantasy_team_id", team.id);

  if (squadError) {
    dashboardMessage(squadError.message);
  }

  const squad = (squadRows ?? []) as SquadPlayerRow[];

  if (squad.length !== SQUAD_SIZE) {
    dashboardMessage("Fill your six-player squad before swapping transfers.");
  }

  if (squad.some((row) => row.player_id === incomingPlayer.id)) {
    dashboardMessage("That player is already in your squad.");
  }

  const outgoingPlayer = squad.find((row) => row.player_id === outgoingPlayerId);

  if (!outgoingPlayer) {
    dashboardMessage("Choose a player from your squad to swap out.");
  }

  if (hasReachedClubLimit(squad, incomingPlayer.club_id, outgoingPlayer.player_id)) {
    dashboardMessage("You can select a maximum of two players from the same club.");
  }

  const usedBudget = squad.reduce((total, row) => total + getNestedPrice(row), 0);
  const newBudgetUse =
    usedBudget - getNestedPrice(outgoingPlayer) + Number(incomingPlayer.price);

  if (newBudgetUse > Number(team.budget)) {
    dashboardMessage("That swap would exceed your budget.");
  }

  const { error: updateError } = await supabase
    .from("fantasy_team_players")
    .update({ player_id: incomingPlayer.id })
    .eq("fantasy_team_id", team.id)
    .eq("player_id", outgoingPlayer.player_id);

  if (updateError) {
    dashboardMessage(updateError.message);
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

  const { data: squadRows, error: squadError } = await supabase
    .from("fantasy_team_players")
    .select("player_id")
    .eq("fantasy_team_id", team.id);

  if (squadError) {
    dashboardMessage(squadError.message);
  }

  if (!(squadRows ?? []).some((row) => row.player_id === playerId)) {
    dashboardMessage("Player not found in your squad.");
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
  const { data: squadRows, error: squadError } = await supabase
    .from("fantasy_team_players")
    .select("player_id, is_captain")
    .eq("fantasy_team_id", team.id);

  if (squadError) {
    dashboardMessage(squadError.message);
  }

  const player = (squadRows ?? []).find((row) => row.player_id === playerId);

  if (!player) {
    dashboardMessage("Player not found in your squad.");
  }

  const { error: deleteError } = await supabase
    .from("fantasy_team_players")
    .delete()
    .eq("fantasy_team_id", team.id)
    .eq("player_id", playerId);

  if (deleteError) {
    dashboardMessage(deleteError.message);
  }

  if (player.is_captain) {
    const nextCaptain = (squadRows ?? []).find((row) => row.player_id !== playerId);

    if (nextCaptain) {
      const { error: captainError } = await supabase
        .from("fantasy_team_players")
        .update({ is_captain: true })
        .eq("fantasy_team_id", team.id)
        .eq("player_id", nextCaptain.player_id);

      if (captainError) {
        dashboardMessage(captainError.message);
      }
    }
  }

  revalidatePath("/dashboard");
}

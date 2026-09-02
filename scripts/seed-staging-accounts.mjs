import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_ACCOUNT_COUNT = 20;
const MAX_ACCOUNT_COUNT = 200;
const DEFAULT_BUDGET = 100000000;
const SQUAD_SIZE = 6;
const STARTER_SIZE = 4;
const MAX_PLAYERS_PER_CLUB = 2;
const SEED_SOURCE = "fantasy-pingisligan-staging-squads-v1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function parseEnvFile(content) {
  const values = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const match = trimmedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    values[match[1]] = match[2]
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
  }

  return values;
}

async function loadStagingEnvironment({ requirePassword }) {
  const filePath = path.join(projectRoot, ".env.staging.local");
  let content;

  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Missing .env.staging.local.");
    throw error;
  }

  const values = parseEnvFile(content);
  const supabaseUrl = values.SUPABASE_URL ?? values.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = values.SUPABASE_SERVICE_ROLE_KEY;
  const expectedProjectRef = values.STAGING_PROJECT_REF;
  const password = values.STAGING_TEST_ACCOUNT_PASSWORD;

  if (values.APP_ENV !== "staging") {
    throw new Error("APP_ENV must be exactly 'staging'.");
  }
  if (!supabaseUrl || !serviceKey || !expectedProjectRef) {
    throw new Error(
      "Staging URL, service key, and STAGING_PROJECT_REF are required in .env.staging.local.",
    );
  }

  const hostname = new URL(supabaseUrl).hostname;
  if (hostname !== `${expectedProjectRef}.supabase.co`) {
    throw new Error(
      `Staging safety check failed: ${hostname} does not match STAGING_PROJECT_REF.`,
    );
  }

  if (requirePassword && (!password || password.length < 8)) {
    throw new Error(
      "STAGING_TEST_ACCOUNT_PASSWORD must contain at least eight characters.",
    );
  }

  return { password, serviceKey, supabaseUrl };
}

function ensureNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function parseArguments(argv) {
  const args = [...argv];
  const firstArgument = args[0];
  const command =
    firstArgument && !firstArgument.startsWith("-") ? args.shift() : "seed";
  let count = DEFAULT_ACCOUNT_COUNT;
  let confirmed = false;

  while (args.length > 0) {
    const argument = args.shift();

    if (argument === "--count") {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1 || value > MAX_ACCOUNT_COUNT) {
        throw new Error(`--count must be an integer from 1 to ${MAX_ACCOUNT_COUNT}.`);
      }
      count = value;
    } else if (argument === "--yes") {
      confirmed = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!new Set(["seed", "status", "cleanup"]).has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  return { command, confirmed, count };
}

function accountDefinition(index) {
  const suffix = String(index).padStart(2, "0");

  return {
    displayName: `Testspelare ${suffix}`,
    email: `fantasy-squad-test-${suffix}@example.com`,
    index,
    teamName: `[TEST] Seedlag ${suffix}`,
  };
}

function isSeededUser(user) {
  return user.app_metadata?.seed_source === SEED_SOURCE;
}

async function listAllUsers(supabase) {
  const users = [];
  const perPage = 1000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    ensureNoError(error, "Could not list Auth users");
    users.push(...data.users);

    if (data.users.length < perPage) break;
  }

  return users;
}

function createRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, seed) {
  const result = [...items];
  const random = createRandom(seed);

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function selectSquad(players, seed, budget) {
  const candidates = shuffled(players, seed);

  function search(startIndex, selected, cost, clubCounts) {
    if (selected.length === SQUAD_SIZE) return selected;

    const playersNeeded = SQUAD_SIZE - selected.length;
    if (candidates.length - startIndex < playersNeeded) return null;

    for (let index = startIndex; index < candidates.length; index += 1) {
      const player = candidates[index];
      const nextCost = cost + player.numericPrice;
      const clubCount = player.club_id
        ? (clubCounts.get(player.club_id) ?? 0)
        : 0;

      if (nextCost > budget || clubCount >= MAX_PLAYERS_PER_CLUB) continue;

      if (player.club_id) clubCounts.set(player.club_id, clubCount + 1);
      selected.push(player);

      const result = search(index + 1, selected, nextCost, clubCounts);
      if (result) return result;

      selected.pop();
      if (player.club_id) {
        if (clubCount === 0) clubCounts.delete(player.club_id);
        else clubCounts.set(player.club_id, clubCount);
      }
    }

    return null;
  }

  const selected = search(0, [], 0, new Map());
  if (!selected) {
    throw new Error(
      `Could not build a six-player squad within the SEK ${budget.toLocaleString("sv-SE")} budget.`,
    );
  }

  return selected;
}

async function loadActivePlayers(supabase) {
  const { data, error } = await supabase
    .from("players")
    .select("id, first_name, last_name, club_id, price")
    .eq("active", true)
    .order("id");
  ensureNoError(error, "Could not load active players");

  const players = (data ?? []).map((player) => ({
    ...player,
    numericPrice: Number(player.price),
  }));

  if (players.length < SQUAD_SIZE) {
    throw new Error(`At least ${SQUAD_SIZE} active players are required.`);
  }
  if (players.some((player) => !Number.isFinite(player.numericPrice))) {
    throw new Error("One or more active players have an invalid price.");
  }

  return players;
}

async function getOrCreateUser(supabase, definition, password, usersByEmail) {
  const emailKey = definition.email.toLowerCase();
  const existingUser = usersByEmail.get(emailKey);

  if (existingUser && !isSeededUser(existingUser)) {
    throw new Error(
      `Refusing to change existing unmarked account ${definition.email}.`,
    );
  }

  if (existingUser) {
    const { data, error } = await supabase.auth.admin.updateUserById(
      existingUser.id,
      {
        password,
        user_metadata: {
          ...existingUser.user_metadata,
          display_name: definition.displayName,
        },
      },
    );
    ensureNoError(error, `Could not update ${definition.email}`);
    return { created: false, user: data.user };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    app_metadata: {
      seed_index: definition.index,
      seed_source: SEED_SOURCE,
    },
    email: definition.email,
    email_confirm: true,
    password,
    user_metadata: { display_name: definition.displayName },
  });
  ensureNoError(error, `Could not create ${definition.email}`);

  if (!data.user) {
    throw new Error(`Supabase did not return the created user ${definition.email}.`);
  }

  usersByEmail.set(emailKey, data.user);
  return { created: true, user: data.user };
}

async function saveTeamAndSquad(supabase, user, definition, squad) {
  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      display_name: definition.displayName,
      id: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  ensureNoError(profileError, `Could not save profile for ${definition.email}`);

  const { data: existingTeam, error: existingTeamError } = await supabase
    .from("fantasy_teams")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  ensureNoError(existingTeamError, `Could not load team for ${definition.email}`);

  let teamId = existingTeam?.id;

  if (teamId) {
    const { error } = await supabase
      .from("fantasy_teams")
      .update({
        budget: DEFAULT_BUDGET,
        name: definition.teamName,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", teamId);
    ensureNoError(error, `Could not update team for ${definition.email}`);
  } else {
    const { data, error } = await supabase
      .from("fantasy_teams")
      .insert({
        budget: DEFAULT_BUDGET,
        name: definition.teamName,
        onboarding_completed: true,
        user_id: user.id,
      })
      .select("id")
      .single();
    ensureNoError(error, `Could not create team for ${definition.email}`);
    teamId = data.id;
  }

  const { error: deleteError } = await supabase
    .from("fantasy_team_players")
    .delete()
    .eq("fantasy_team_id", teamId);
  ensureNoError(deleteError, `Could not reset squad for ${definition.email}`);

  const rows = squad.map((player, slot) => ({
    fantasy_team_id: teamId,
    is_captain: slot === 0,
    player_id: player.id,
    position: slot < STARTER_SIZE ? "starter" : "bench",
  }));
  const { error: insertError } = await supabase
    .from("fantasy_team_players")
    .insert(rows);
  ensureNoError(insertError, `Could not save squad for ${definition.email}`);
}

async function seedAccounts(supabase, password, count) {
  const players = await loadActivePlayers(supabase);
  const allUsers = await listAllUsers(supabase);
  const usersByEmail = new Map(
    allUsers
      .filter((user) => user.email)
      .map((user) => [user.email.toLowerCase(), user]),
  );
  const completed = [];

  for (let index = 1; index <= count; index += 1) {
    const definition = accountDefinition(index);
    const squad = selectSquad(players, 20260901 + index * 7919, DEFAULT_BUDGET);
    let createdUser = null;

    try {
      const { created, user } = await getOrCreateUser(
        supabase,
        definition,
        password,
        usersByEmail,
      );
      if (created) createdUser = user;

      await saveTeamAndSquad(supabase, user, definition, squad);
      completed.push({
        email: definition.email,
        result: created ? "created" : "updated",
        team: definition.teamName,
      });
      console.log(`[${index}/${count}] ${definition.email}`);
    } catch (error) {
      if (createdUser) {
        const { error: rollbackError } =
          await supabase.auth.admin.deleteUser(createdUser.id);
        if (rollbackError) {
          console.error(
            `Rollback failed for ${definition.email}: ${rollbackError.message}`,
          );
        }
      }
      throw error;
    }
  }

  console.table(completed);
  console.log(
    `Seeded ${completed.length} staging accounts. Their shared password is read from STAGING_TEST_ACCOUNT_PASSWORD.`,
  );
}

async function showStatus(supabase) {
  const users = (await listAllUsers(supabase)).filter(isSeededUser);
  if (users.length === 0) {
    console.log("No marked staging squad accounts found.");
    return;
  }

  const userIds = users.map((user) => user.id);
  const { data: teams, error: teamError } = await supabase
    .from("fantasy_teams")
    .select("id, user_id, name, onboarding_completed")
    .in("user_id", userIds);
  ensureNoError(teamError, "Could not load seeded teams");

  const teamIds = (teams ?? []).map((team) => team.id);
  let squadRows = [];
  if (teamIds.length > 0) {
    const { data, error } = await supabase
      .from("fantasy_team_players")
      .select("fantasy_team_id")
      .in("fantasy_team_id", teamIds);
    ensureNoError(error, "Could not load seeded squads");
    squadRows = data ?? [];
  }

  const teamsByUserId = new Map((teams ?? []).map((team) => [team.user_id, team]));
  const squadCounts = new Map();
  for (const row of squadRows) {
    squadCounts.set(
      row.fantasy_team_id,
      (squadCounts.get(row.fantasy_team_id) ?? 0) + 1,
    );
  }

  console.table(
    users
      .sort(
        (first, second) =>
          Number(first.app_metadata.seed_index) -
          Number(second.app_metadata.seed_index),
      )
      .map((user) => {
        const team = teamsByUserId.get(user.id);
        return {
          email: user.email,
          onboarded: team?.onboarding_completed ?? false,
          players: team ? (squadCounts.get(team.id) ?? 0) : 0,
          team: team?.name ?? "missing",
        };
      }),
  );
}

async function cleanupAccounts(supabase, confirmed) {
  if (!confirmed) {
    throw new Error(
      "Cleanup deletes all accounts marked by this script. Run it again with --yes.",
    );
  }

  const users = (await listAllUsers(supabase)).filter(isSeededUser);

  for (const [index, user] of users.entries()) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    ensureNoError(error, `Could not delete ${user.email ?? user.id}`);
    console.log(`[${index + 1}/${users.length}] Deleted ${user.email ?? user.id}`);
  }

  console.log(`Deleted ${users.length} marked staging accounts and their teams.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const environment = await loadStagingEnvironment({
    requirePassword: options.command === "seed",
  });
  const supabase = createClient(environment.supabaseUrl, environment.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (options.command === "seed") {
    await seedAccounts(supabase, environment.password, options.count);
  } else if (options.command === "status") {
    await showStatus(supabase);
  } else {
    await cleanupAccounts(supabase, options.confirmed);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

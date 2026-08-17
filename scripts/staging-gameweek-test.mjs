import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROUND_ID_BASE = -901001;
const MATCH_ID_BASE = -902001;
const PARTICIPANT_ID_BASE = -903001;
const SUBMATCH_ID_BASE = -904001;
const ROLE_ID_BASE = -905001;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const defaultFixtureFile = path.join(
  projectRoot,
  "test-data",
  "staging-gameweeks.json",
);

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

async function loadStagingEnvironment() {
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
  const fixtureFile = values.STAGING_TEST_DATA_FILE
    ? path.resolve(projectRoot, values.STAGING_TEST_DATA_FILE)
    : defaultFixtureFile;

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

  return { expectedProjectRef, fixtureFile, serviceKey, supabaseUrl };
}

function addMinutes(date, minutes) {
  const timestamp = date instanceof Date ? date.getTime() : Date.parse(date);
  if (Number.isNaN(timestamp)) throw new Error(`Invalid date: ${date}`);
  return new Date(timestamp + minutes * 60 * 1000).toISOString();
}

function addHours(date, hours) {
  return addMinutes(date, hours * 60);
}

function displayName(player) {
  return `${player.first_name} ${player.last_name}`.trim();
}

function normalized(value) {
  return value.trim().toLocaleLowerCase("sv-SE");
}

function ensureNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateResult(result, context) {
  assert(result && typeof result === "object", `${context} must be an object.`);

  if (result.walkover === true) {
    assert(
      result.winner === "home" || result.winner === "away",
      `${context}.winner must be "home" or "away" for a walkover.`,
    );
    assert(
      result.homeSets === undefined && result.awaySets === undefined,
      `${context} must omit set scores for a walkover.`,
    );
    return;
  }

  assert(
    Number.isInteger(result.homeSets) && Number.isInteger(result.awaySets),
    `${context} must contain integer homeSets and awaySets.`,
  );
  assert(
    result.homeSets >= 0 && result.awaySets >= 0,
    `${context} set scores cannot be negative.`,
  );
  assert(
    result.homeSets !== result.awaySets,
    `${context} cannot be a draw.`,
  );
  assert(
    Math.max(result.homeSets, result.awaySets) === 3 &&
      Math.min(result.homeSets, result.awaySets) <= 2,
    `${context} must be a completed best-of-five result such as 3-0, 3-1, or 3-2.`,
  );
}

function validateTeam(team, context) {
  assert(team && typeof team === "object", `${context} must be an object.`);
  assert(typeof team.club === "string" && team.club.trim(), `${context}.club is required.`);
  assert(Array.isArray(team.players) && team.players.length > 0, `${context}.players is required.`);
  assert(
    team.players.every((player) => typeof player === "string" && player.trim()),
    `${context}.players must contain non-empty player names.`,
  );
  assert(
    new Set(team.players.map(normalized)).size === team.players.length,
    `${context}.players contains a duplicate name.`,
  );
}

function validateScenario(raw) {
  assert(raw && typeof raw === "object", "The staging fixture must be a JSON object.");
  assert(raw.version === 1, "The staging fixture version must be 1.");
  assert(
    Number.isInteger(raw.stageId) && raw.stageId <= -900000,
    "stageId must be a reserved integer at or below -900000.",
  );
  assert(Array.isArray(raw.gameweeks) && raw.gameweeks.length > 0, "gameweeks is required.");

  const keys = new Set();
  const roundOrders = new Set();

  raw.gameweeks.forEach((gameweek, gameweekIndex) => {
    const context = `gameweeks[${gameweekIndex}]`;
    assert(
      typeof gameweek.key === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(gameweek.key),
      `${context}.key must use lowercase letters, numbers, underscores, or hyphens.`,
    );
    assert(!keys.has(gameweek.key), `Duplicate gameweek key: ${gameweek.key}.`);
    keys.add(gameweek.key);
    assert(typeof gameweek.name === "string" && gameweek.name.trim(), `${context}.name is required.`);
    assert(Number.isInteger(gameweek.roundOrder), `${context}.roundOrder must be an integer.`);
    assert(!roundOrders.has(gameweek.roundOrder), `Duplicate roundOrder: ${gameweek.roundOrder}.`);
    roundOrders.add(gameweek.roundOrder);
    assert(
      typeof gameweek.startsAfterHours === "number" && gameweek.startsAfterHours >= 2,
      `${context}.startsAfterHours must be at least 2.`,
    );
    assert(
      Array.isArray(gameweek.fixtures) && gameweek.fixtures.length > 0,
      `${context}.fixtures is required.`,
    );

    const fixtureKeys = new Set();
    gameweek.fixtures.forEach((fixture, fixtureIndex) => {
      const fixtureContext = `${context}.fixtures[${fixtureIndex}]`;
      assert(
        typeof fixture.key === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(fixture.key),
        `${fixtureContext}.key is invalid.`,
      );
      assert(!fixtureKeys.has(fixture.key), `Duplicate fixture key in ${gameweek.key}: ${fixture.key}.`);
      fixtureKeys.add(fixture.key);
      assert(
        fixture.winner === "home" || fixture.winner === "away" || fixture.winner === null,
        `${fixtureContext}.winner must be "home", "away", or null.`,
      );
      assert(
        Number.isFinite(fixture.startsAfterMinutes) && fixture.startsAfterMinutes >= 0,
        `${fixtureContext}.startsAfterMinutes must be zero or greater.`,
      );
      assert(
        Number.isFinite(fixture.durationMinutes) && fixture.durationMinutes > 0,
        `${fixtureContext}.durationMinutes must be greater than zero.`,
      );
      validateTeam(fixture.home, `${fixtureContext}.home`);
      validateTeam(fixture.away, `${fixtureContext}.away`);
      assert(
        normalized(fixture.home.club) !== normalized(fixture.away.club),
        `${fixtureContext} must use two different clubs.`,
      );
      assert(
        Array.isArray(fixture.matches) && fixture.matches.length > 0,
        `${fixtureContext}.matches is required.`,
      );

      const homeNames = new Set(fixture.home.players.map(normalized));
      const awayNames = new Set(fixture.away.players.map(normalized));
      fixture.matches.forEach((match, matchIndex) => {
        const matchContext = `${fixtureContext}.matches[${matchIndex}]`;
        assert(
          match.type === "singles" || match.type === "doubles",
          `${matchContext}.type must be "singles" or "doubles".`,
        );
        const expectedPlayers = match.type === "singles" ? 1 : 2;
        assert(
          Array.isArray(match.homePlayers) && match.homePlayers.length === expectedPlayers,
          `${matchContext}.homePlayers must contain ${expectedPlayers} player(s).`,
        );
        assert(
          Array.isArray(match.awayPlayers) && match.awayPlayers.length === expectedPlayers,
          `${matchContext}.awayPlayers must contain ${expectedPlayers} player(s).`,
        );
        assert(
          match.homePlayers.every((name) => homeNames.has(normalized(name))),
          `${matchContext}.homePlayers must be listed in the home team.`,
        );
        assert(
          match.awayPlayers.every((name) => awayNames.has(normalized(name))),
          `${matchContext}.awayPlayers must be listed in the away team.`,
        );
        assert(
          new Set(match.homePlayers.map(normalized)).size === expectedPlayers &&
            new Set(match.awayPlayers.map(normalized)).size === expectedPlayers,
          `${matchContext} contains a duplicate player.`,
        );
        validateResult(match.result, `${matchContext}.result`);
      });
    });
  });
}

function addReservedIds(raw) {
  return {
    ...raw,
    gameweeks: raw.gameweeks.map((gameweek, gameweekIndex) => ({
      ...gameweek,
      roundId: ROUND_ID_BASE - gameweekIndex,
      fixtures: gameweek.fixtures.map((fixture, fixtureIndex) => {
        const fixtureOffset = gameweekIndex * 100 + fixtureIndex;
        return {
          ...fixture,
          matchId: MATCH_ID_BASE - fixtureOffset,
          homeParticipantId: PARTICIPANT_ID_BASE - fixtureOffset * 2,
          awayParticipantId: PARTICIPANT_ID_BASE - fixtureOffset * 2 - 1,
          matches: fixture.matches.map((match, matchIndex) => ({
            ...match,
            submatchId:
              SUBMATCH_ID_BASE - gameweekIndex * 1000 - fixtureIndex * 100 - matchIndex,
          })),
        };
      }),
    })),
  };
}

async function loadScenario(filePath) {
  let raw;
  try {
    raw = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Missing staging fixture file: ${filePath}.`);
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    throw error;
  }
  validateScenario(raw);
  return addReservedIds(raw);
}

async function loadTeamsAndSquads(supabase, gameweekId = null) {
  const { data: teams, error: teamError } = await supabase
    .from("fantasy_teams")
    .select("id, name, created_at, onboarding_completed")
    .eq("onboarding_completed", true)
    .order("created_at", { ascending: true });
  ensureNoError(teamError, "Could not load fantasy teams");

  if ((teams ?? []).length < 2) {
    throw new Error("Create at least two completed staging fantasy teams first.");
  }

  const sourceTable = gameweekId
    ? "fantasy_team_gameweek_players"
    : "fantasy_team_players";
  let query = supabase.from(sourceTable).select("*");
  if (gameweekId) query = query.eq("fantasy_gameweek_id", gameweekId);

  const { data: squadRows, error: squadError } = await query;
  ensureNoError(squadError, "Could not load fantasy squads");

  const playerIds = [...new Set((squadRows ?? []).map((row) => row.player_id))];
  const { data: players, error: playerError } = await supabase
    .from("players")
    .select("id, first_name, last_name")
    .in("id", playerIds);
  ensureNoError(playerError, "Could not load squad players");

  const playersById = new Map((players ?? []).map((player) => [player.id, player]));
  const rowsByTeam = new Map(
    (teams ?? []).map((team) => [
      team.id,
      (squadRows ?? [])
        .filter((row) => row.fantasy_team_id === team.id)
        .map((row) => ({ ...row, player: playersById.get(row.player_id) })),
    ]),
  );

  for (const team of teams ?? []) {
    const rows = rowsByTeam.get(team.id) ?? [];
    if (rows.length !== 6 || rows.some((row) => !row.player)) {
      throw new Error(`Staging team "${team.name}" must have six valid players.`);
    }
  }

  return { rowsByTeam, teams: teams ?? [] };
}

async function loadActivePlayers(supabase) {
  const { data, error } = await supabase
    .from("players")
    .select(
      "id, profixio_id, stupa_user_role_id, club_id, first_name, last_name, ranking_position, active",
    )
    .eq("active", true)
    .not("club_id", "is", null)
    .order("ranking_position", { ascending: true, nullsFirst: false });
  ensureNoError(error, "Could not load active players");
  return data ?? [];
}

async function loadClubs(supabase) {
  const { data, error } = await supabase.from("clubs").select("id, name");
  ensureNoError(error, "Could not load clubs");
  return data ?? [];
}

function uniqueMap(rows, getKey, entityName) {
  const map = new Map();
  for (const row of rows) {
    const key = getKey(row);
    if (map.has(key)) throw new Error(`Staging contains duplicate ${entityName}: ${key}.`);
    map.set(key, row);
  }
  return map;
}

async function resolveScenario(supabase, scenario) {
  const [activePlayers, clubs] = await Promise.all([
    loadActivePlayers(supabase),
    loadClubs(supabase),
  ]);
  const clubsByName = uniqueMap(clubs, (club) => normalized(club.name), "club name");
  const clubsById = new Map(clubs.map((club) => [club.id, club]));
  const playersByName = uniqueMap(
    activePlayers,
    (player) => normalized(displayName(player)),
    "active player name",
  );
  const roleIds = new Map();

  const gameweeks = scenario.gameweeks.map((gameweek) => ({
    ...gameweek,
    fixtures: gameweek.fixtures.map((fixture) => {
      const homeClub = clubsByName.get(normalized(fixture.home.club));
      const awayClub = clubsByName.get(normalized(fixture.away.club));
      if (!homeClub) throw new Error(`Unknown staging club: ${fixture.home.club}.`);
      if (!awayClub) throw new Error(`Unknown staging club: ${fixture.away.club}.`);

      const resolvePlayers = (names, club, side) =>
        names.map((name) => {
          const player = playersByName.get(normalized(name));
          if (!player) throw new Error(`Unknown active staging player: ${name}.`);
          if (player.club_id !== club.id) {
            const registeredClub = clubsById.get(player.club_id);
            throw new Error(
              `${name} is registered to ${registeredClub?.name ?? player.club_id}, not ${side} club ${club.name}.`,
            );
          }
          if (!roleIds.has(player.id)) roleIds.set(player.id, ROLE_ID_BASE - roleIds.size);
          return player;
        });

      const homePlayers = resolvePlayers(fixture.home.players, homeClub, "home");
      const awayPlayers = resolvePlayers(fixture.away.players, awayClub, "away");
      const fixturePlayersByName = new Map(
        [...homePlayers, ...awayPlayers].map((player) => [normalized(displayName(player)), player]),
      );

      return {
        ...fixture,
        awayClub,
        awayPlayers,
        fixturePlayersByName,
        homeClub,
        homePlayers,
      };
    }),
  }));

  return { ...scenario, activePlayers, gameweeks, roleIds };
}

function selectDefinition(scenario, key, required = true) {
  if (!key) {
    if (!required) return null;
    if (scenario.gameweeks.length === 1) return scenario.gameweeks[0];
    throw new Error(
      `Choose a gameweek key: ${scenario.gameweeks.map((gameweek) => gameweek.key).join(", ")}.`,
    );
  }
  const gameweek = scenario.gameweeks.find((item) => item.key === key);
  if (!gameweek) {
    throw new Error(
      `Unknown gameweek key "${key}". Choose: ${scenario.gameweeks.map((item) => item.key).join(", ")}.`,
    );
  }
  return gameweek;
}

async function getDatabaseGameweek(supabase, definition, required = true) {
  const { data, error } = await supabase
    .from("fantasy_gameweeks")
    .select("*")
    .eq("stupa_round_id", definition.roundId)
    .maybeSingle();
  ensureNoError(error, `Could not load ${definition.key}`);
  if (!data && required) {
    throw new Error(`Gameweek "${definition.key}" is not installed. Run setup first.`);
  }
  return data;
}

async function getDatabaseMatches(supabase, gameweekId) {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("fantasy_gameweek_id", gameweekId);
  ensureNoError(error, "Could not load test fixtures");
  return data ?? [];
}

function configuredTimes(gameweek, baseDate = new Date()) {
  const nominalStart = addHours(baseDate, gameweek.startsAfterHours);
  const fixtures = gameweek.fixtures.map((fixture) => {
    const startsAt = addMinutes(nominalStart, fixture.startsAfterMinutes);
    return {
      definition: fixture,
      endsAt: addMinutes(startsAt, fixture.durationMinutes),
      startsAt,
    };
  });
  const firstMatchStartsAt = fixtures.reduce(
    (earliest, fixture) =>
      Date.parse(fixture.startsAt) < Date.parse(earliest) ? fixture.startsAt : earliest,
    fixtures[0].startsAt,
  );
  const lastMatchEndsAt = fixtures.reduce(
    (latest, fixture) =>
      Date.parse(fixture.endsAt) > Date.parse(latest) ? fixture.endsAt : latest,
    fixtures[0].endsAt,
  );
  return {
    firstMatchStartsAt,
    fixtures,
    lastMatchEndsAt,
    lockAt: addHours(firstMatchStartsAt, -2),
    unlockAt: addHours(lastMatchEndsAt, 2),
  };
}

async function setup(supabase, scenario) {
  const [{ data: existingGameweeks, error: gameweekError }, { data: existingMatches, error: matchError }] =
    await Promise.all([
      supabase.from("fantasy_gameweeks").select("id").eq("stupa_stage_id", scenario.stageId),
      supabase.from("matches").select("id").eq("stupa_stage_id", scenario.stageId),
    ]);
  ensureNoError(gameweekError, "Could not check existing test gameweeks");
  ensureNoError(matchError, "Could not check existing test fixtures");
  if ((existingGameweeks?.length ?? 0) > 0 || (existingMatches?.length ?? 0) > 0) {
    throw new Error("Staging test data already exists. Run cleanup before setup again.");
  }

  await loadTeamsAndSquads(supabase);
  const now = new Date();
  const inserted = [];

  for (const definition of scenario.gameweeks) {
    const times = configuredTimes(definition, now);
    const { data: gameweek, error } = await supabase
      .from("fantasy_gameweeks")
      .insert({
        stupa_stage_id: scenario.stageId,
        stupa_round_id: definition.roundId,
        name: definition.name,
        round_order: definition.roundOrder,
        first_match_starts_at: times.firstMatchStartsAt,
        last_match_ends_at: times.lastMatchEndsAt,
        lock_at: times.lockAt,
        unlock_at: times.unlockAt,
        imported_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .select("id, name, lock_at")
      .single();
    ensureNoError(error, `Could not create ${definition.key}; run cleanup before retrying`);

    const matchRows = times.fixtures.map(({ definition: fixture, endsAt, startsAt }) => ({
      profixio_id: `test:staging:${fixture.matchId}`,
      stupa_match_id: fixture.matchId,
      stupa_stage_id: scenario.stageId,
      fantasy_gameweek_id: gameweek.id,
      stupa_round_id: definition.roundId,
      home_team_stupa_participant_id: fixture.homeParticipantId,
      away_team_stupa_participant_id: fixture.awayParticipantId,
      home_club_id: fixture.homeClub.id,
      away_club_id: fixture.awayClub.id,
      home_team_name: `[TEST] ${fixture.homeClub.name}`,
      away_team_name: `[TEST] ${fixture.awayClub.name}`,
      starts_at: startsAt,
      ends_at: endsAt,
      status: "scheduled",
      source_updated_at: now.toISOString(),
    }));
    const { error: fixturesError } = await supabase.from("matches").insert(matchRows);
    ensureNoError(fixturesError, `Could not create fixtures for ${definition.key}; run cleanup before retrying`);
    inserted.push({
      fixtures: definition.fixtures.length,
      gameweek: definition.key,
      lock_at: gameweek.lock_at,
      name: gameweek.name,
    });
  }

  console.log(`Created ${inserted.length} configured staging gameweeks.`);
  console.table(inserted);
  console.log("Choose a gameweek key when running lock, score, or unlock.");
}

function lockWindowTimes(definition, now = new Date()) {
  const lockAt = addMinutes(now, -1);
  const firstMatchStartsAt = addHours(lockAt, 2);
  const minimumOffset = Math.min(
    ...definition.fixtures.map((fixture) => fixture.startsAfterMinutes),
  );
  const fixtures = definition.fixtures.map((fixture) => {
    const startsAt = addMinutes(
      firstMatchStartsAt,
      fixture.startsAfterMinutes - minimumOffset,
    );
    return {
      definition: fixture,
      endsAt: addMinutes(startsAt, fixture.durationMinutes),
      startsAt,
    };
  });
  const lastMatchEndsAt = fixtures.reduce(
    (latest, fixture) =>
      Date.parse(fixture.endsAt) > Date.parse(latest) ? fixture.endsAt : latest,
    fixtures[0].endsAt,
  );
  return {
    firstMatchStartsAt,
    fixtures,
    lastMatchEndsAt,
    lockAt,
    unlockAt: addHours(lastMatchEndsAt, 2),
  };
}

async function updateFixtureTimes(supabase, databaseMatches, fixtureTimes) {
  const matchesByStupaId = new Map(
    databaseMatches.map((match) => [match.stupa_match_id, match]),
  );
  for (const fixtureTime of fixtureTimes) {
    const databaseMatch = matchesByStupaId.get(fixtureTime.definition.matchId);
    if (!databaseMatch) {
      throw new Error(`Missing database fixture: ${fixtureTime.definition.key}.`);
    }
    const { error } = await supabase
      .from("matches")
      .update({ starts_at: fixtureTime.startsAt, ends_at: fixtureTime.endsAt })
      .eq("id", databaseMatch.id);
    ensureNoError(error, `Could not update fixture ${fixtureTime.definition.key}`);
  }
}

async function lock(supabase, definition, waitForCron = false) {
  const gameweek = await getDatabaseGameweek(supabase, definition);
  const databaseMatches = await getDatabaseMatches(supabase, gameweek.id);

  if (waitForCron) {
    const { count, error } = await supabase
      .from("fantasy_team_gameweek_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("fantasy_gameweek_id", gameweek.id);
    ensureNoError(error, "Could not check existing test snapshots");
    if ((count ?? 0) > 0) {
      throw new Error(
        `Gameweek "${definition.key}" already has snapshots, so it cannot prove Cron created them.`,
      );
    }
  }

  const now = new Date();
  const times = lockWindowTimes(definition, now);
  const { error } = await supabase
    .from("fantasy_gameweeks")
    .update({
      lock_at: times.lockAt,
      first_match_starts_at: times.firstMatchStartsAt,
      last_match_ends_at: times.lastMatchEndsAt,
      unlock_at: times.unlockAt,
      updated_at: now.toISOString(),
    })
    .eq("id", gameweek.id);
  ensureNoError(error, `Could not move ${definition.key} into its lock window`);
  await updateFixtureTimes(supabase, databaseMatches, times.fixtures);

  if (waitForCron) {
    console.log(`Moved ${definition.key} into its lock window.`);
    console.log("The snapshot function was not called by this command.");
    console.log("Wait for the next five-minute Cron run, then run status.");
    return;
  }

  const { data: snapshotResult, error: snapshotError } = await supabase.rpc(
    "snapshot_locked_squads",
  );
  ensureNoError(snapshotError, "Could not snapshot locked squads");
  const { count, error: countError } = await supabase
    .from("fantasy_team_gameweek_snapshots")
    .select("*", { count: "exact", head: true })
    .eq("fantasy_gameweek_id", gameweek.id);
  ensureNoError(countError, "Could not count test snapshots");
  console.log("Snapshot RPC result:", snapshotResult);
  console.log(`Stored ${count ?? 0} team snapshots for ${definition.key}.`);
}

function resultWinner(result) {
  if (result.walkover) return result.winner;
  return result.homeSets > result.awaySets ? "home" : "away";
}

function resultRow({
  lineupLabel,
  player,
  roleId,
  setsLost,
  setsWon,
  sideOrder,
  submatchId,
  teamParticipantId,
  walkover,
  won,
}) {
  return {
    stupa_submatch_id: submatchId,
    player_id: player.id,
    stupa_user_role_id: roleId,
    stupa_license_id: player.profixio_id,
    player_name: displayName(player),
    team_stupa_participant_id: teamParticipantId,
    side_order: sideOrder,
    lineup_label: lineupLabel,
    won,
    sets_won: setsWon,
    sets_lost: setsLost,
    points_won: 0,
    points_lost: 0,
    set_wins: [],
    set_points: [],
    walkover,
    raw_payload: {
      detail: { participant_label: lineupLabel },
      side: { walkover, walkover_reason: walkover ? "Test walkover" : null },
    },
    source_updated_at: new Date().toISOString(),
  };
}

function playersForMatch(fixture, names) {
  return names.map((name) => {
    const player = fixture.fixturePlayersByName.get(normalized(name));
    if (!player) throw new Error(`Could not resolve configured player ${name}.`);
    return player;
  });
}

function buildResultRows(definition, roleIds) {
  const now = new Date().toISOString();
  const fixtures = definition.fixtures.map((fixture) => {
    const parentWinner = fixture.winner;
    const submatches = [];
    const results = [];

    fixture.matches.forEach((match, matchIndex) => {
      const result = match.result;
      const winner = resultWinner(result);
      const homePlayers = playersForMatch(fixture, match.homePlayers);
      const awayPlayers = playersForMatch(fixture, match.awayPlayers);
      const homeWon = winner === "home";
      const homeSets = result.walkover ? 0 : result.homeSets;
      const awaySets = result.walkover ? 0 : result.awaySets;

      submatches.push({
        stupa_submatch_id: match.submatchId,
        match_order: matchIndex + 1,
        status: "SCORED",
        is_golden_match: false,
        winning_team_stupa_id: homeWon
          ? fixture.homeParticipantId
          : fixture.awayParticipantId,
        raw_payload: { test: true, order: matchIndex + 1 },
        source_updated_at: now,
      });

      const addSideRows = (players, side) => {
        const isHome = side === "home";
        const won = isHome ? homeWon : !homeWon;
        const setsWon = isHome ? homeSets : awaySets;
        const setsLost = isHome ? awaySets : homeSets;
        players.forEach((player, playerIndex) => {
          const roster = isHome ? fixture.homePlayers : fixture.awayPlayers;
          const rosterIndex = roster.findIndex((item) => item.id === player.id);
          results.push(
            resultRow({
              lineupLabel:
                match.type === "doubles"
                  ? `D${playerIndex + 1}`
                  : `${isHome ? "A" : "B"}${rosterIndex + 1}`,
              player,
              roleId: roleIds.get(player.id),
              setsLost,
              setsWon,
              sideOrder: isHome ? 1 : 2,
              submatchId: match.submatchId,
              teamParticipantId: isHome
                ? fixture.homeParticipantId
                : fixture.awayParticipantId,
              walkover: result.walkover === true && won,
              won,
            }),
          );
        });
      };

      addSideRows(homePlayers, "home");
      addSideRows(awayPlayers, "away");
    });

    return { fixture, parentWinner, results, submatches };
  });
  return fixtures;
}

function expectedPlayerPoints(definition, activePlayers) {
  const points = new Map(activePlayers.map((player) => [player.id, 0]));
  const singles = new Map();

  for (const fixture of definition.fixtures) {
    const winningSide = fixture.winner;
    const winningClub =
      winningSide === "home"
        ? fixture.homeClub
        : winningSide === "away"
          ? fixture.awayClub
          : null;
    if (winningClub) {
      for (const player of activePlayers) {
        if (player.club_id === winningClub.id) {
          points.set(player.id, (points.get(player.id) ?? 0) + 3);
        }
      }
    }

    for (const match of fixture.matches) {
      const result = match.result;
      const winner = resultWinner(result);
      for (const side of ["home", "away"]) {
        const players = playersForMatch(
          fixture,
          side === "home" ? match.homePlayers : match.awayPlayers,
        );
        const won = winner === side;
        const setsWon = result.walkover
          ? 0
          : side === "home"
            ? result.homeSets
            : result.awaySets;
        const setsLost = result.walkover
          ? 0
          : side === "home"
            ? result.awaySets
            : result.homeSets;

        for (const player of players) {
          let matchPoints;
          if (match.type === "doubles") {
            const scoringSetsWon = result.walkover && won ? 3 : setsWon;
            matchPoints =
              (won ? 2 : 0) +
              Math.ceil((scoringSetsWon - setsLost) / players.length);
          } else if (result.walkover) {
            matchPoints = won ? 7 : 0;
          } else {
            matchPoints = (won ? 4 : 0) + setsWon - setsLost;
          }
          points.set(player.id, (points.get(player.id) ?? 0) + matchPoints);

          if (match.type === "singles") {
            const record = singles.get(player.id) ?? { played: 0, won: 0 };
            record.played += 1;
            if (won) record.won += 1;
            singles.set(player.id, record);
          }
        }
      }
    }
  }

  for (const [playerId, record] of singles) {
    if (record.played >= 2 && record.played === record.won) {
      points.set(playerId, (points.get(playerId) ?? 0) + 2);
    }
  }
  return points;
}

function expectedTeamPoints(team, rows, playerPoints, snapshot) {
  const playerTotal = rows.reduce((total, row) => {
    const points = playerPoints.get(row.player_id) ?? 0;
    if (row.position === "bench" && snapshot.active_chip !== "bench_boost") return total;
    if (row.is_captain && row.position === "starter") {
      return total + points * (snapshot.active_chip === "triple_captain" ? 3 : 2);
    }
    return total + points;
  }, 0);
  return {
    fantasy_team_id: team.id,
    name: team.name,
    points: playerTotal + Number(snapshot.transfer_penalty_points ?? 0),
  };
}

function formatConfiguredResult(match) {
  const result = match.result;
  if (result.walkover) return `${result.winner} walkover`;
  return `${result.homeSets}-${result.awaySets}`;
}

async function seedAndScore(supabase, definition, activePlayers, roleIds) {
  const gameweek = await getDatabaseGameweek(supabase, definition);
  const databaseMatches = await getDatabaseMatches(supabase, gameweek.id);
  const matchesByStupaId = new Map(
    databaseMatches.map((match) => [match.stupa_match_id, match]),
  );
  const { rowsByTeam, teams } = await loadTeamsAndSquads(supabase, gameweek.id);
  const fixtureRows = buildResultRows(definition, roleIds);
  const now = new Date();
  const minimumOffset = Math.min(
    ...definition.fixtures.map((fixture) => fixture.startsAfterMinutes),
  );
  const firstMatchStartsAt = addMinutes(now, -30);
  let lastMatchEndsAt = firstMatchStartsAt;

  for (const fixtureRow of fixtureRows) {
    const fixture = fixtureRow.fixture;
    const databaseMatch = matchesByStupaId.get(fixture.matchId);
    if (!databaseMatch) throw new Error(`Missing database fixture: ${fixture.key}.`);
    const startsAt = addMinutes(
      firstMatchStartsAt,
      fixture.startsAfterMinutes - minimumOffset,
    );
    const endsAt = addMinutes(startsAt, fixture.durationMinutes);
    if (Date.parse(endsAt) > Date.parse(lastMatchEndsAt)) lastMatchEndsAt = endsAt;
    const winningParticipantId =
      fixtureRow.parentWinner === "home"
        ? fixture.homeParticipantId
        : fixtureRow.parentWinner === "away"
          ? fixture.awayParticipantId
          : null;
    const { error } = await supabase
      .from("matches")
      .update({
        starts_at: startsAt,
        ends_at: endsAt,
        status: "scored",
        winning_team_stupa_participant_id: winningParticipantId,
        source_updated_at: now.toISOString(),
      })
      .eq("id", databaseMatch.id);
    ensureNoError(error, `Could not score parent fixture ${fixture.key}`);
  }

  const { error: gameweekError } = await supabase
    .from("fantasy_gameweeks")
    .update({
      first_match_starts_at: firstMatchStartsAt,
      last_match_ends_at: lastMatchEndsAt,
      updated_at: now.toISOString(),
    })
    .eq("id", gameweek.id);
  ensureNoError(gameweekError, `Could not start ${definition.key}`);

  const databaseMatchIds = databaseMatches.map((match) => match.id);
  const { error: deleteError } = await supabase
    .from("stupa_submatches")
    .delete()
    .in("match_id", databaseMatchIds);
  ensureNoError(deleteError, "Could not replace existing test submatches");

  const submatches = fixtureRows.flatMap((fixtureRow) => {
    const databaseMatch = matchesByStupaId.get(fixtureRow.fixture.matchId);
    return fixtureRow.submatches.map((row) => ({ ...row, match_id: databaseMatch.id }));
  });
  const results = fixtureRows.flatMap((fixtureRow) => fixtureRow.results);
  const { error: submatchError } = await supabase.from("stupa_submatches").insert(submatches);
  ensureNoError(submatchError, "Could not write test submatches");
  const { error: resultError } = await supabase.from("player_submatch_results").insert(results);
  ensureNoError(resultError, "Could not write test player results");

  const { error: firstScoreError } = await supabase.rpc(
    "calculate_fantasy_gameweek_points",
    { target_gameweek_id: gameweek.id },
  );
  ensureNoError(firstScoreError, "Could not calculate test points");
  const { data: firstTotals, error: firstTotalError } = await supabase
    .from("fantasy_team_gameweek_points")
    .select("fantasy_team_id, points")
    .eq("fantasy_gameweek_id", gameweek.id)
    .order("fantasy_team_id");
  ensureNoError(firstTotalError, "Could not read first test totals");
  const { error: secondScoreError } = await supabase.rpc(
    "calculate_fantasy_gameweek_points",
    { target_gameweek_id: gameweek.id },
  );
  ensureNoError(secondScoreError, "Could not repeat the test calculation");
  const { data: secondTotals, error: secondTotalError } = await supabase
    .from("fantasy_team_gameweek_points")
    .select("fantasy_team_id, points")
    .eq("fantasy_gameweek_id", gameweek.id)
    .order("fantasy_team_id");
  ensureNoError(secondTotalError, "Could not read repeated test totals");
  if (JSON.stringify(firstTotals) !== JSON.stringify(secondTotals)) {
    throw new Error("Idempotency check failed: repeated scoring changed team totals.");
  }

  const { data: snapshots, error: snapshotError } = await supabase
    .from("fantasy_team_gameweek_snapshots")
    .select("fantasy_team_id, active_chip, transfer_penalty_points")
    .eq("fantasy_gameweek_id", gameweek.id);
  ensureNoError(snapshotError, "Could not load test snapshot settings");
  const snapshotsByTeam = new Map(
    (snapshots ?? []).map((snapshot) => [snapshot.fantasy_team_id, snapshot]),
  );
  const expectedPlayers = expectedPlayerPoints(definition, activePlayers);
  const expectedTotals = teams.map((team) => {
    const snapshot = snapshotsByTeam.get(team.id);
    if (!snapshot) throw new Error(`Missing locked snapshot for "${team.name}".`);
    return expectedTeamPoints(team, rowsByTeam.get(team.id) ?? [], expectedPlayers, snapshot);
  });
  const actualByTeam = new Map(
    (secondTotals ?? []).map((row) => [row.fantasy_team_id, Number(row.points)]),
  );
  for (const expected of expectedTotals) {
    if (actualByTeam.get(expected.fantasy_team_id) !== expected.points) {
      throw new Error(
        `Score assertion failed for "${expected.name}": expected ${expected.points}, got ${actualByTeam.get(expected.fantasy_team_id)}.`,
      );
    }
  }

  console.log(`Scored ${definition.key}.`);
  console.log("Configured matches:");
  console.table(
    definition.fixtures.flatMap((fixture) =>
      fixture.matches.map((match) => ({
        away: match.awayPlayers.join(" / "),
        fixture: `${fixture.home.club} vs ${fixture.away.club}`,
        home: match.homePlayers.join(" / "),
        result: formatConfiguredResult(match),
        type: match.type,
      })),
    ),
  );
  const participatingIds = new Set(
    definition.fixtures.flatMap((fixture) => [
      ...fixture.homePlayers.map((player) => player.id),
      ...fixture.awayPlayers.map((player) => player.id),
    ]),
  );
  console.log("Verified player totals:");
  console.table(
    activePlayers
      .filter((player) => participatingIds.has(player.id))
      .map((player) => ({ player: displayName(player), points: expectedPlayers.get(player.id) ?? 0 })),
  );
  console.log("Verified fantasy-team totals:");
  console.table(expectedTotals.map(({ name, points }) => ({ team: name, points })));
  console.log("Repeated scoring produced identical totals.");
}

async function unlock(supabase, definition) {
  const gameweek = await getDatabaseGameweek(supabase, definition);
  const databaseMatches = await getDatabaseMatches(supabase, gameweek.id);
  const matchesByStupaId = new Map(
    databaseMatches.map((match) => [match.stupa_match_id, match]),
  );
  const now = new Date();
  const firstMatchStartsAt = addHours(now, -4);
  const minimumOffset = Math.min(
    ...definition.fixtures.map((fixture) => fixture.startsAfterMinutes),
  );
  let lastMatchEndsAt = firstMatchStartsAt;

  for (const fixture of definition.fixtures) {
    const databaseMatch = matchesByStupaId.get(fixture.matchId);
    if (!databaseMatch) throw new Error(`Missing database fixture: ${fixture.key}.`);
    const startsAt = addMinutes(
      firstMatchStartsAt,
      fixture.startsAfterMinutes - minimumOffset,
    );
    const endsAt = addMinutes(startsAt, fixture.durationMinutes);
    if (Date.parse(endsAt) > Date.parse(lastMatchEndsAt)) lastMatchEndsAt = endsAt;
    const { error } = await supabase
      .from("matches")
      .update({ starts_at: startsAt, ends_at: endsAt })
      .eq("id", databaseMatch.id);
    ensureNoError(error, `Could not complete fixture ${fixture.key}`);
  }

  const { error } = await supabase
    .from("fantasy_gameweeks")
    .update({
      lock_at: addHours(firstMatchStartsAt, -2),
      first_match_starts_at: firstMatchStartsAt,
      last_match_ends_at: lastMatchEndsAt,
      unlock_at: addMinutes(now, -1),
      updated_at: now.toISOString(),
    })
    .eq("id", gameweek.id);
  ensureNoError(error, `Could not complete ${definition.key}`);
  const { data: usedChips, error: chipError } = await supabase.rpc("mark_used_chips");
  ensureNoError(chipError, "Could not mark locked chips as used");
  console.log(`Completed ${definition.key}.`);
  console.log(`Marked ${usedChips ?? 0} chips as used.`);
}

async function statusRow(supabase, definition) {
  const gameweek = await getDatabaseGameweek(supabase, definition, false);
  if (!gameweek) {
    return {
      gameweek: definition.key,
      installed: false,
      result_rows: 0,
      scored_teams: 0,
      snapshots: 0,
    };
  }
  const submatchIds = definition.fixtures.flatMap((fixture) =>
    fixture.matches.map((match) => match.submatchId),
  );
  const [{ count: snapshots, error: snapshotError }, { count: results, error: resultError }, { count: totals, error: totalError }] =
    await Promise.all([
      supabase
        .from("fantasy_team_gameweek_snapshots")
        .select("*", { count: "exact", head: true })
        .eq("fantasy_gameweek_id", gameweek.id),
      supabase
        .from("player_submatch_results")
        .select("*", { count: "exact", head: true })
        .in("stupa_submatch_id", submatchIds),
      supabase
        .from("fantasy_team_gameweek_points")
        .select("*", { count: "exact", head: true })
        .eq("fantasy_gameweek_id", gameweek.id),
    ]);
  ensureNoError(snapshotError, `Could not count snapshots for ${definition.key}`);
  ensureNoError(resultError, `Could not count results for ${definition.key}`);
  ensureNoError(totalError, `Could not count totals for ${definition.key}`);
  return {
    gameweek: definition.key,
    installed: true,
    lock_at: gameweek.lock_at,
    result_rows: results ?? 0,
    scored_teams: totals ?? 0,
    snapshots: snapshots ?? 0,
    unlock_at: gameweek.unlock_at,
  };
}

async function status(supabase, scenario, key) {
  const definitions = key ? [selectDefinition(scenario, key)] : scenario.gameweeks;
  const rows = [];
  for (const definition of definitions) rows.push(await statusRow(supabase, definition));
  console.table(rows);
}

function printValidatedScenario(scenario, fixtureFile) {
  console.log(`Validated ${path.relative(projectRoot, fixtureFile)} against staging.`);
  console.table(
    scenario.gameweeks.map((gameweek) => ({
      fixtures: gameweek.fixtures.length,
      gameweek: gameweek.key,
      matches: gameweek.fixtures.reduce(
        (total, fixture) => total + fixture.matches.length,
        0,
      ),
      name: gameweek.name,
      round_order: gameweek.roundOrder,
    })),
  );
}

async function cleanup(supabase, scenario, key) {
  const definition = key ? selectDefinition(scenario, key) : null;
  let query = supabase
    .from("fantasy_gameweeks")
    .select("id, stupa_round_id")
    .eq("stupa_stage_id", scenario.stageId);
  if (definition) query = query.eq("stupa_round_id", definition.roundId);
  const { data: gameweeks, error: loadError } = await query;
  ensureNoError(loadError, "Could not load test gameweeks for cleanup");
  const gameweekIds = (gameweeks ?? []).map((gameweek) => gameweek.id);

  if (gameweekIds.length > 0) {
    const { error: matchError } = await supabase
      .from("matches")
      .delete()
      .in("fantasy_gameweek_id", gameweekIds);
    ensureNoError(matchError, "Could not delete test fixtures");
    const { error: gameweekError } = await supabase
      .from("fantasy_gameweeks")
      .delete()
      .in("id", gameweekIds);
    ensureNoError(gameweekError, "Could not delete test gameweeks");
  }

  if (!definition) {
    const { error: orphanError } = await supabase
      .from("matches")
      .delete()
      .eq("stupa_stage_id", scenario.stageId);
    ensureNoError(orphanError, "Could not delete orphaned test fixtures");
  }
  console.log(
    definition
      ? `Removed staging gameweek ${definition.key}.`
      : "Removed all configured staging gameweeks. Real stage data was untouched.",
  );
}

async function main() {
  const action = process.argv[2];
  const key = process.argv[3];
  const actions = new Set([
    "validate",
    "setup",
    "lock",
    "lock-cron",
    "score",
    "unlock",
    "status",
    "cleanup",
  ]);
  if (!actions.has(action)) {
    throw new Error(
      "Choose an action: validate, setup, lock, lock-cron, score, unlock, status, or cleanup.",
    );
  }
  if (action === "setup" && key) {
    throw new Error("setup creates every gameweek in the JSON fixture and does not accept a key.");
  }

  const environment = await loadStagingEnvironment();
  const scenario = await loadScenario(environment.fixtureFile);
  console.log(`Target confirmed: staging (${environment.expectedProjectRef}).`);
  console.log(`Fixture file: ${path.relative(projectRoot, environment.fixtureFile)}.`);
  const supabase = createClient(environment.supabaseUrl, environment.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const requiresResolvedScenario = !["status", "cleanup"].includes(action);
  const resolvedScenario = requiresResolvedScenario
    ? await resolveScenario(supabase, scenario)
    : scenario;

  if (action === "validate") {
    printValidatedScenario(resolvedScenario, environment.fixtureFile);
  }
  if (action === "setup") await setup(supabase, resolvedScenario);
  if (action === "status") await status(supabase, scenario, key);
  if (action === "cleanup") await cleanup(supabase, scenario, key);
  if (["lock", "lock-cron", "score", "unlock"].includes(action)) {
    const definition = selectDefinition(resolvedScenario, key);
    if (action === "lock") await lock(supabase, definition);
    if (action === "lock-cron") await lock(supabase, definition, true);
    if (action === "score") {
      await seedAndScore(
        supabase,
        definition,
        resolvedScenario.activePlayers,
        resolvedScenario.roleIds,
      );
    }
    if (action === "unlock") await unlock(supabase, definition);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

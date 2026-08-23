import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROFIXIO_RANKING_URL =
  "https://www.profixio.com/fx/ranking_sbtf/ranking_sbtf_list.php?gender=m";
const PLAYERS_PER_CLUB = 10;
const MIN_RANKING_POINTS = 2250;
const PRICE_OFFSET = 2200;
const PRICE_MULTIPLIER = 100000;
const WORLD_RANK_PRICE_POOL = 50000000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const clubsFile = process.env.CLUBS_FILE
  ? path.resolve(process.env.CLUBS_FILE)
  : path.join(projectRoot, "clubs.txt");

function requireEnv(name, fallbackName) {
  const value = process.env[name] ?? process.env[fallbackName];

  if (!value) {
    const names = fallbackName ? `${name} or ${fallbackName}` : name;
    throw new Error(`Missing required environment variable: ${names}`);
  }

  return value;
}

async function loadEnvFile(filePath) {
  let content;

  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const match = trimmedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;

    if (process.env[key]) {
      continue;
    }

    process.env[key] = rawValue
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
  }
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function textFromHtml(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function searchable(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sv-SE");
}

function canonicalClubName(value) {
  const normalized = searchable(value);
  const isEskilstunaByStiga = normalized.includes("eskilstuna by stiga");
  const isLindenEskilstuna =
    normalized.includes("linden") &&
    (normalized.includes("eskilstuna") || normalized.includes("esklistuna"));

  return isEskilstunaByStiga || isLindenEskilstuna
    ? "Linden BTK Eskilstuna"
    : value.trim();
}

function splitPlayerName(name) {
  const [lastName, ...firstNameParts] = name.split(",").map((part) => part.trim());

  return {
    firstName: firstNameParts.join(", ") || name.trim(),
    lastName: firstNameParts.length > 0 ? lastName : "",
  };
}

function parsePlacement(value) {
  const worldRankingMatch = value.match(/\bWR\s*0*(\d+)\b/i);
  const worldRankingPosition = Number(worldRankingMatch?.[1]);
  const rankingPosition = Number(value.match(/(\d+)\s*$/)?.[1]);

  return {
    rankingPosition: Number.isFinite(rankingPosition) ? rankingPosition : null,
    worldRankingPosition:
      Number.isInteger(worldRankingPosition) && worldRankingPosition > 0
        ? worldRankingPosition
        : null,
  };
}

function calculatePlayerPrice(rankingPoints, worldRankingPosition) {
  const rankingPrice =
    (Math.max(MIN_RANKING_POINTS, rankingPoints) - PRICE_OFFSET) *
    PRICE_MULTIPLIER;
  const worldRankingPrice = worldRankingPosition
    ? Math.round(WORLD_RANK_PRICE_POOL / Math.sqrt(worldRankingPosition))
    : 0;

  return rankingPrice + worldRankingPrice;
}

function parseRankingRows(html) {
  const rows = [];
  const rowMatches = html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi);

  for (const rowMatch of rowMatches) {
    const rowHtml = rowMatch[1];

    if (!rowHtml.includes("rml_poeng")) {
      continue;
    }

    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => match[1],
    );

    if (cells.length < 6) {
      continue;
    }

    const profixioPlayerId = rowHtml.match(/id=['"]rml:(\d+):/)?.[1];
    const placementText = textFromHtml(cells[0]);
    const { rankingPosition, worldRankingPosition } =
      parsePlacement(placementText);
    const fullName = textFromHtml(cells[2]);
    const birthYear = Number(textFromHtml(cells[3]));
    const clubName = canonicalClubName(
      textFromHtml(cells[4]).replace(/\*+$/g, ""),
    );
    const rankingPoints = Number(textFromHtml(cells[5]).replace(/\D/g, ""));

    if (!profixioPlayerId || !fullName || !clubName || !rankingPoints) {
      continue;
    }

    const { firstName, lastName } = splitPlayerName(fullName);

    rows.push({
      profixioPlayerId,
      rankingPosition,
      worldRankingPosition,
      firstName,
      lastName,
      birthYear: Number.isFinite(birthYear) ? birthYear : null,
      clubName,
      rankingPoints,
      price: calculatePlayerPrice(rankingPoints, worldRankingPosition),
    });
  }

  return rows;
}

async function readClubSearches() {
  const content = await readFile(clubsFile, "utf8");

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function pickPlayersForClubs(rows, clubSearches) {
  const selectedById = new Map();
  const summary = [];

  for (const clubSearch of clubSearches) {
    const needle = searchable(clubSearch);
    const matches = rows
      .filter((row) => searchable(row.clubName).includes(needle))
      .slice(0, PLAYERS_PER_CLUB);

    summary.push({
      clubSearch,
      count: matches.length,
      players: matches,
    });

    for (const player of matches) {
      selectedById.set(player.profixioPlayerId, player);
    }
  }

  return {
    players: [...selectedById.values()],
    summary,
  };
}

async function upsertClub(supabase, clubName) {
  const { data, error } = await supabase
    .from("clubs")
    .upsert({ name: clubName }, { onConflict: "name" })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not upsert club "${clubName}": ${error.message}`);
  }

  return data.id;
}

async function upsertPlayers(supabase, players) {
  const clubIdsByName = new Map();

  for (const player of players) {
    if (!clubIdsByName.has(player.clubName)) {
      clubIdsByName.set(player.clubName, await upsertClub(supabase, player.clubName));
    }
  }

  const payload = players.map((player) => ({
    profixio_id: player.profixioPlayerId,
    club_id: clubIdsByName.get(player.clubName),
    first_name: player.firstName,
    last_name: player.lastName,
    birth_year: player.birthYear,
    ranking_position: player.rankingPosition,
    ranking_points: player.rankingPoints,
    price: player.price,
    active: true,
    source_updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("players")
    .upsert(payload, { onConflict: "profixio_id" });

  if (error) {
    throw new Error(`Could not upsert players: ${error.message}`);
  }
}

async function getPendingRefreshGameweek(supabase) {
  const now = new Date().toISOString();
  const { data: gameweek, error } = await supabase
    .from("fantasy_gameweeks")
    .select("id, name, lock_at, unlock_at")
    .lte("lock_at", now)
    .is("data_refreshed_at", null)
    .order("unlock_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not check pending gameweek refreshes: ${error.message}`);
  }

  return gameweek;
}

async function hasStartedGameweek(supabase) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("fantasy_gameweeks")
    .select("id")
    .lte("lock_at", now)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not inspect gameweek state: ${error.message}`);
  }

  return Boolean(data);
}

async function markGameweekRefreshed(supabase, gameweek) {
  const refreshedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("fantasy_gameweeks")
    .update({ data_refreshed_at: refreshedAt, updated_at: refreshedAt })
    .eq("id", gameweek.id)
    .is("data_refreshed_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not reopen transfers: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      `${gameweek.name} was already marked refreshed by another process.`,
    );
  }

  console.log(`Refreshed ${gameweek.name}; transfers are open.`);
}

async function main() {
  await loadEnvFile(path.join(projectRoot, ".env.local"));
  await loadEnvFile(path.join(projectRoot, ".env"));

  const dryRun =
    process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  const afterUnlock = process.argv.includes("--after-unlock");
  let supabase = null;
  let refreshGameweek = null;

  if (!dryRun) {
    const supabaseUrl = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const pendingGameweek = await getPendingRefreshGameweek(supabase);

    if (afterUnlock) {
      if (!pendingGameweek) {
        console.log("No gameweek is waiting for a data refresh; skipping.");
        return;
      }

      if (Date.now() <= Date.parse(pendingGameweek.unlock_at)) {
        console.log(
          `${pendingGameweek.name} is still active until ${pendingGameweek.unlock_at}; ` +
            "skipping scheduled price refresh.",
        );
        return;
      }

      refreshGameweek = pendingGameweek;
      console.log(`Refreshing player prices after ${pendingGameweek.name}.`);
    } else {
      if (pendingGameweek) {
        throw new Error(
          `${pendingGameweek.name} is locked or waiting for its data refresh. ` +
            "Import results first, then run the player importer with --after-unlock.",
        );
      }

      if (await hasStartedGameweek(supabase)) {
        throw new Error(
          "In-season prices may only refresh after a gameweek unlock. " +
            "Use --after-unlock after importing results.",
        );
      }
    }
  }

  const clubSearches = await readClubSearches();

  if (clubSearches.length === 0) {
    throw new Error(`No clubs found in ${clubsFile}`);
  }

  const response = await fetch(PROFIXIO_RANKING_URL, {
    headers: {
      "user-agent": "fantasy-pingisligan-importer/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Could not fetch Profixio ranking page: ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();
  const rankingRows = parseRankingRows(html);
  const { players, summary } = pickPlayersForClubs(rankingRows, clubSearches);

  if (!dryRun && players.length === 0) {
    throw new Error("No players were parsed; transfers will remain locked.");
  }

  if (!dryRun) {
    await upsertPlayers(supabase, players);

    if (refreshGameweek) {
      await markGameweekRefreshed(supabase, refreshGameweek);
    }
  }

  console.log(`Read ${clubSearches.length} club search strings from ${clubsFile}`);
  console.log(`Parsed ${rankingRows.length} players from the first Profixio page`);
  console.log(`${dryRun ? "Would upsert" : "Upserted"} ${players.length} unique players`);

  for (const item of summary) {
    console.log(`${item.clubSearch}: ${item.count}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

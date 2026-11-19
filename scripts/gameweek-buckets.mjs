import { localDateTimeToUtcIso, nextStockholmMidnightUtcIso } from "./stockholm-time.mjs";

const localDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
});

export function stockholmWeek(value) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) throw new Error(`Invalid fixture timestamp: ${value}`);
  const day = new Date(`${localDate.format(at)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

export function medianTimestamp(values) {
  if (!values.length) throw new Error("Cannot anchor a round without dated fixtures.");
  const times = values.map(Date.parse).sort((a, b) => a - b);
  if (times.some(at => !Number.isFinite(at))) throw new Error("Invalid anchor timestamp.");
  return new Date((times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2).toISOString();
}

export function midpointBoundary(left, right) {
  const a = Date.parse(left), b = Date.parse(right);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) throw new Error("Anchors must be strictly chronological.");
  const midpoint = (a + b) / 2;
  const previous = Date.parse(localDateTimeToUtcIso(`${localDate.format(midpoint)}T00:00:00`));
  const next = Date.parse(nextStockholmMidnightUtcIso(midpoint));
  return new Date(midpoint - previous < next - midpoint ? previous : next).toISOString();
}

export function validatePeriods(periods) {
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if ((p.bucket_starts_at === null && i !== 0) || (p.bucket_ends_at === null && i !== periods.length - 1) ||
        (p.bucket_starts_at !== null && !Number.isFinite(Date.parse(p.bucket_starts_at))) ||
        (p.bucket_ends_at !== null && !Number.isFinite(Date.parse(p.bucket_ends_at))) ||
        (p.bucket_starts_at !== null && p.bucket_ends_at !== null && Date.parse(p.bucket_starts_at) >= Date.parse(p.bucket_ends_at)) ||
        (i > 0 && p.bucket_starts_at !== periods[i - 1].bucket_ends_at)) {
      throw new Error(`Invalid, overlapping or non-increasing bucket boundaries: ${JSON.stringify(periods)}`);
    }
  }
}

export function fixturePeriod(startsAt, periods) {
  const at = Date.parse(startsAt);
  if (!Number.isFinite(at)) throw new Error(`Invalid fixture kickoff: ${startsAt}`);
  return periods.find(p => (p.bucket_starts_at === null || at >= Date.parse(p.bucket_starts_at)) &&
    (p.bucket_ends_at === null || at < Date.parse(p.bucket_ends_at))) ?? null;
}

export function initializeBuckets(fixtures, stageId) {
  const rounds = new Map();
  for (const m of fixtures) {
    if (!Number.isInteger(m.stupa_round_id) || !Number.isInteger(m.round_order)) throw new Error(`Fixture ${m.stupa_match_id}: round ID/order is required.`);
    const round = rounds.get(m.stupa_round_id) ?? {
      stupa_stage_id: stageId, stupa_round_id: m.stupa_round_id, round_order: m.round_order, name: m.round_name,
      weeks: new Map(),
    };
    if (round.round_order !== m.round_order) throw new Error(`Conflicting round order: ${m.stupa_round_id}`);
    if (m.starts_at && !["cancelled", "canceled", "deleted"].includes(m.status)) {
      const week = stockholmWeek(m.starts_at);
      round.weeks.set(week, [...(round.weeks.get(week) ?? []), { id: m.stupa_match_id, starts_at: m.starts_at }]);
    }
    rounds.set(m.stupa_round_id, round);
  }
  const ordered = [...rounds.values()].sort((a, b) => a.round_order - b.round_order);
  for (const round of ordered) {
    const weeks = [...round.weeks].map(([week, matches]) => ({ week, count: matches.length, fixtures: matches }));
    const max = Math.max(0, ...weeks.map(w => w.count));
    const winners = weeks.filter(w => w.count === max);
    if (winners.length !== 1) throw new Error(`Ambiguous anchor for ${round.name} (${round.stupa_round_id}): ${JSON.stringify(weeks)}`);
    round.anchor_week = winners[0].week;
    round.anchor_at = medianTimestamp(winners[0].fixtures.map(m => m.starts_at));
  }
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1], b = ordered[i];
    if (a.round_order === b.round_order || a.anchor_week === b.anchor_week || Date.parse(a.anchor_at) >= Date.parse(b.anchor_at)) {
      throw new Error(`Conflicting or non-chronological anchors: ${JSON.stringify(ordered.map(r => ({ round: r.name, id: r.stupa_round_id, order: r.round_order, week: r.anchor_week, anchor: r.anchor_at, weeks: [...r.weeks].map(([week, fixtures]) => ({ week, count: fixtures.length, fixtures })) })))}`);
    }
  }
  const boundaries = ordered.slice(1).map((r, i) => midpointBoundary(ordered[i].anchor_at, r.anchor_at));
  const periods = ordered.map((r, i) => ({
    stupa_stage_id: r.stupa_stage_id, stupa_round_id: r.stupa_round_id, round_order: r.round_order, name: r.name,
    anchor_week: r.anchor_week, anchor_at: r.anchor_at,
    bucket_starts_at: i === 0 ? null : boundaries[i - 1],
    bucket_ends_at: i === ordered.length - 1 ? null : boundaries[i],
  }));
  validatePeriods(periods);
  return periods;
}

export function normalizeSchedule(matches, stageId) {
  const ids = new Set();
  return matches.map(m => {
    if (!Number.isInteger(m.id) || ids.has(m.id)) throw new Error(`Invalid or duplicate fixture ID: ${m.id}`);
    ids.add(m.id);
    const status = m.is_deleted ? "deleted" : String(m.status ?? "").toLowerCase();
    // These spellings are already recognized by the application. Unknown
    // upstream states fail closed rather than being inferred from missing dates.
    if (!["scheduled", "not_started", "in_progress", "scored", "postponed", "cancelled", "canceled", "deleted"].includes(status)) {
      throw new Error(`Fixture ${m.id}: unsupported STUPA status ${status}; manual source verification required.`);
    }
    const startsAt = localDateTimeToUtcIso(m.start_time);
    const endsAt = localDateTimeToUtcIso(m.end_time ?? m.slot?.end_time);
    if ((!startsAt || !endsAt) && !["postponed", "cancelled", "canceled", "deleted"].includes(status)) {
      throw new Error(`Fixture ${m.id}: missing confirmed kickoff/end (${status}).`);
    }
    if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new Error(`Fixture ${m.id}: end precedes kickoff.`);
    const participant = order => (m.participants ?? []).find(p => p.order === order) ?? m.participants?.[order - 1];
    return {
      stupa_match_id: m.id, profixio_id: `stupa:${m.id}`, stupa_stage_id: stageId,
      stupa_round_id: m.round_id, round_order: m.round?.order, round_name: m.round?.name ?? `Round ${m.round_id}`,
      stupa_event_match_id: m.event_match_id ?? null, stupa_group_id: m.group_id ?? null,
      home_team_name: participant(1)?.participant_name?.trim() ?? null,
      away_team_name: participant(2)?.participant_name?.trim() ?? null,
      home_team_stupa_participant_id: participant(1)?.participant_id ?? null,
      away_team_stupa_participant_id: participant(2)?.participant_id ?? null,
      winning_team_stupa_participant_id: m.winner ?? null, starts_at: startsAt, ends_at: endsAt, status,
    };
  });
}

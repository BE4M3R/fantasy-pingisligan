import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DAILY_RESULTS_CRON, checkResultsRefresh, resultsRefreshDecision, stockholmDayWindow } from "./results-refresh-schedule.mjs";

const interval = (now, matchStarts = []) => resultsRefreshDecision({ now, matchStarts, eventName: "schedule", schedule: "7,22,37,52 * * * *" });

test("00:07 refresh always runs, including off days and delayed Actions starts", async () => {
  for (const now of ["2026-09-20T22:07:00Z", "2026-09-21T03:47:00Z", "2026-12-20T23:07:00Z"]) {
    const result = await checkResultsRefresh({ now, eventName: "schedule", schedule: DAILY_RESULTS_CRON,
      fetchImpl: () => assert.fail("Daily refresh must not depend on existing fixtures") });
    assert.equal(result.shouldRun, true);
    assert.equal(result.refreshSchedule, true);
  }
});

test("manual runs refresh fixtures and results regardless of match-day gating", async () => {
  const result = await checkResultsRefresh({ now: "2026-09-21T06:00:00Z", eventName: "workflow_dispatch",
    fetchImpl: () => assert.fail("Manual refresh needs no gate query") });
  assert.equal(result.shouldRun, true);
  assert.equal(result.refreshSchedule, true);
});

test("15-minute polling starts at the first fixture and lasts until midnight even after play ends", () => {
  const starts = ["2026-09-21T16:00:00Z", "2026-09-21T18:00:00Z"];
  assert.equal(interval("2026-09-21T15:37:00Z", starts).shouldRun, false);
  assert.equal(interval("2026-09-21T16:07:00Z", starts).shouldRun, true);
  assert.equal(interval("2026-09-21T16:37:00Z", starts).shouldRun, true);
  assert.equal(interval("2026-09-21T21:37:00Z", starts).shouldRun, true);
  assert.equal(interval("2026-09-21T22:07:00Z", starts).shouldRun, false);
  assert.equal(interval("2026-09-21T22:37:00Z", starts).shouldRun, false);
  assert.equal(interval("2026-09-21T21:37:00Z", starts).refreshSchedule, false);
});

test("a gameweek spanning several dates polls on each playing day but skips gaps and pre-start hours", () => {
  const starts = ["2026-09-21T16:30:00Z", "2026-09-23T17:00:00Z"];
  assert.equal(interval("2026-09-21T16:37:00Z", starts).shouldRun, true);
  assert.equal(interval("2026-09-22T18:07:00Z", starts).shouldRun, false);
  assert.equal(interval("2026-09-23T16:37:00Z", starts).shouldRun, false);
  assert.equal(interval("2026-09-23T17:07:00Z", starts).shouldRun, true);
  assert.equal(interval("2026-09-23T21:37:00Z", starts).shouldRun, true);
  assert.equal(interval("2026-09-24T18:07:00Z", starts).shouldRun, false);
});

test("Swedish day boundaries handle winter, summer and both DST transitions", () => {
  const cases = [
    ["2026-09-21T12:00:00Z", "2026-09-20T22:00:00.000Z", "2026-09-21T22:00:00.000Z"],
    ["2026-12-21T12:00:00Z", "2026-12-20T23:00:00.000Z", "2026-12-21T23:00:00.000Z"],
    ["2026-03-29T12:00:00Z", "2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
    ["2026-10-25T12:00:00Z", "2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
  ];
  for (const [now, start, end] of cases) {
    const actual = stockholmDayWindow(now);
    assert.equal(actual.start, start);
    assert.equal(actual.end, end);
  }
  assert.equal(interval("2026-12-21T22:37:00Z", ["2026-12-21T18:00:00Z"]).shouldRun, true);
  assert.equal(interval("2026-12-21T23:07:00Z", ["2026-12-21T18:00:00Z"]).shouldRun, false);
});

test("the gate performs only one bounded stage-specific database read; no STUPA or writes", async () => {
  for (const matches of [[], [{ starts_at: "2026-09-21T16:00:00Z" }]]) {
    let requests = 0;
    const result = await checkResultsRefresh({
      now: "2026-09-21T16:37:00Z", eventName: "schedule", schedule: "22,37,52 * * * *",
      stageId: -900001, supabaseUrl: "http://127.0.0.1:54321", serviceKey: "test-key",
      fetchImpl: async (url, options) => {
        requests++;
        assert.equal(url.origin, "http://127.0.0.1:54321");
        assert.equal(url.pathname, "/rest/v1/matches");
        assert.equal(options.method ?? "GET", "GET");
        assert.equal(url.searchParams.get("select"), "starts_at");
        assert.equal(url.searchParams.get("stupa_stage_id"), "eq.-900001");
        assert.equal(url.searchParams.get("fantasy_gameweek_id"), "not.is.null");
        assert.deepEqual(url.searchParams.getAll("starts_at"), ["gte.2026-09-20T22:00:00.000Z", "lte.2026-09-21T16:37:00.000Z"]);
        assert.equal(url.searchParams.get("limit"), "1");
        assert.match(url.searchParams.get("or"), /cancelled,canceled,postponed,deleted/);
        return Response.json(matches);
      },
    });
    assert.equal(requests, 1);
    assert.equal(result.shouldRun, matches.length > 0);
    assert.equal(result.refreshSchedule, false);
  }
});

test("failed fixture checks fail visibly instead of silently skipping needed imports", async () => {
  const input = { now: "2026-09-21T16:07:00Z", eventName: "schedule", schedule: "7 1-23 * * *", supabaseUrl: "http://127.0.0.1:54321", serviceKey: "test" };
  await assert.rejects(checkResultsRefresh({ ...input, fetchImpl: async () => new Response("failed", { status: 503 }) }), /HTTP 503/);
  await assert.rejects(checkResultsRefresh({ ...input, fetchImpl: async () => Response.json({ unexpected: true }) }), /Unexpected fixture/);
  await assert.rejects(checkResultsRefresh({ ...input, fetchImpl: async () => Response.json([{ starts_at: "invalid" }]) }), /Unexpected fixture/);
  assert.throws(() => interval("invalid"), /Invalid refresh-check time/);
});

test("workflow runs every 15 minutes from :07 in Swedish time, with gated imports", async () => {
  // js-yaml is already installed by ESLint; no runtime dependency is added.
  const { load } = await import("js-yaml");
  const workflow = load(await readFile(new URL("../.github/workflows/import-results.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on.schedule, [
    { cron: DAILY_RESULTS_CRON, timezone: "Europe/Stockholm" },
    { cron: "22,37,52 * * * *", timezone: "Europe/Stockholm" },
    { cron: "7 1-23 * * *", timezone: "Europe/Stockholm" },
  ]);
  const steps = workflow.jobs["import-results"].steps;
  const gate = steps.findIndex((step) => step.id === "cadence");
  const install = steps.findIndex((step) => step.run === "npm ci");
  const schedule = steps.findIndex((step) => step.run === "npm run import:schedule");
  const results = steps.findIndex((step) => step.run?.includes("npm run import:results"));
  assert.ok(gate < install && install < schedule && schedule < results);
  assert.match(steps[install].if, /should_run == 'true'/);
  assert.match(steps[schedule].if, /refresh_schedule == 'true'/);
  assert.match(steps[results].if, /should_run == 'true'/);
  assert.match(steps[results].run, /--complete-gameweek-refresh/);
});

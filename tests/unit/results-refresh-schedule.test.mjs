import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DAILY_RESULTS_CRON, checkResultsRefresh, parseRefreshCheckTime, resultsRefreshDecision, resultsRefreshReport, stockholmDayWindow } from "../../scripts/results-refresh-schedule.mjs";
import { verifyStagingImportTarget } from "../../scripts/verify-staging-import-target.mjs";

const interval = (now, matchStarts = []) => resultsRefreshDecision({ now, matchStarts, eventName: "workflow_dispatch", dispatchKind: "poll" });

test("staging check accepts timezone formats copied from Supabase", () => {
  for (const value of [
    "2026-10-13 16:00:00+00", "2026-10-13 16:00:00+0000",
    "2026-10-13 16:00:00+00:00", "2026-10-13T16:00:00Z",
  ]) {
    assert.equal(parseRefreshCheckTime(value).toISOString(), "2026-10-13T16:00:00.000Z");
  }
  assert.throws(() => parseRefreshCheckTime("2026-10-13 16:00:00"), /UTC offset/);
  assert.throws(() => parseRefreshCheckTime("2026-10-13 16:00:00+99"), /UTC offset/);
});

test("check output identifies the checked time without presenting day bounds as a polling window", () => {
  const report = resultsRefreshReport({ shouldRun: true, refreshSchedule: false, reason: "Within a fixture polling window" }, "2026-10-13T16:00:00Z");
  assert.deepEqual(report, {
    checkedAtUtc: "2026-10-13T16:00:00.000Z",
    checkedAtStockholm: "2026-10-13 18:00",
    shouldRun: true,
    refreshSchedule: false,
    reason: "Within a fixture polling window",
  });
  assert.equal("start" in report, false);
  assert.equal("end" in report, false);
});

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

test("15-minute polling stays continuous until five hours after the last match start", () => {
  const first = "2026-09-21T10:00:00Z";
  const second = "2026-09-21T18:00:00Z";
  assert.equal(interval("2026-09-21T09:52:00Z", [first]).shouldRun, false);
  assert.equal(interval("2026-09-21T10:07:00Z", [first]).shouldRun, true);
  assert.equal(interval("2026-09-21T14:52:00Z", [first]).shouldRun, true);
  assert.equal(interval("2026-09-21T15:00:00Z", [first]).shouldRun, false);
  assert.equal(interval("2026-09-21T15:07:00Z", [first, second]).shouldRun, true);
  assert.equal(interval("2026-09-21T17:52:00Z", [first, second]).shouldRun, true);
  assert.equal(interval("2026-09-21T18:07:00Z", [first, second]).shouldRun, true);
  assert.equal(interval("2026-09-21T21:52:00Z", [first, second]).shouldRun, true);
  assert.equal(interval("2026-09-21T22:07:00Z", [first, second]).shouldRun, true);
  assert.equal(interval("2026-09-21T22:52:00Z", [first, second]).shouldRun, true);
  assert.equal(interval("2026-09-21T23:07:00Z", [first, second]).shouldRun, false);
  assert.equal(interval("2026-09-21T16:52:00Z", ["2026-09-21T12:00:00Z"]).shouldRun, true);
  assert.equal(interval("2026-09-21T17:00:00Z", ["2026-09-21T12:00:00Z"]).shouldRun, false);
  assert.equal(interval("2026-09-21T18:22:00Z", [first, second]).refreshSchedule, false);
});

test("a gameweek spanning several dates polls on each playing day but skips gaps and pre-start hours", () => {
  const starts = ["2026-09-21T16:30:00Z", "2026-09-23T17:00:00Z"];
  assert.equal(interval("2026-09-21T16:37:00Z", starts).shouldRun, true);
  assert.equal(interval("2026-09-21T21:37:00Z", starts).shouldRun, false);
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
  assert.equal(interval("2026-12-20T23:22:00Z", ["2026-12-20T23:00:00Z"]).shouldRun, true);
});

test("dispatched polls ask the shared database window rule without contacting STUPA", async () => {
  for (const due of [false, true]) {
    let requests = 0;
    const result = await checkResultsRefresh({
      now: "2026-09-21T15:37:00Z", eventName: "workflow_dispatch", dispatchKind: "poll",
      stageId: -900001, supabaseUrl: "http://127.0.0.1:54321", serviceKey: "test-key",
      fetchImpl: async (url, options) => {
        requests++;
        assert.equal(url.origin, "http://127.0.0.1:54321");
        assert.equal(url.pathname, "/rest/v1/rpc/results_refresh_window_active");
        assert.equal(options.method, "POST");
        assert.equal(options.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(options.body), { p_at: "2026-09-21T15:37:00.000Z", p_stage_id: -900001 });
        return Response.json(due);
      },
    });
    assert.equal(requests, 1);
    assert.equal(result.shouldRun, due);
    assert.equal(result.refreshSchedule, false);
  }
});

test("failed fixture checks fail visibly instead of silently skipping needed imports", async () => {
  const input = { now: "2026-09-21T16:07:00Z", eventName: "workflow_dispatch", dispatchKind: "poll", supabaseUrl: "http://127.0.0.1:54321", serviceKey: "test" };
  await assert.rejects(checkResultsRefresh({ ...input, fetchImpl: async () => new Response("failed", { status: 503 }) }), /HTTP 503/);
  await assert.rejects(checkResultsRefresh({ ...input, fetchImpl: async () => Response.json({ unexpected: true }) }), /Unexpected fixture-window/);
  assert.throws(() => interval("invalid"), /Invalid refresh-check time/);
  assert.throws(() => resultsRefreshDecision({ now: input.now, eventName: "workflow_dispatch", dispatchKind: "invalid" }), /Unsupported results refresh/);
});

test("a match at Stockholm midnight starts that day's polling window", () => {
  assert.equal(interval("2026-09-21T00:22:00Z", ["2026-09-20T22:00:00Z"]).shouldRun, true);
});

test("a late fixture keeps the previous playing day's window open past midnight", () => {
  const late = "2026-09-21T21:00:00Z"; // 23:00 Stockholm
  assert.equal(interval("2026-09-22T00:22:00Z", [late]).shouldRun, true);
  assert.equal(interval("2026-09-22T01:52:00Z", [late]).shouldRun, true);
  assert.equal(interval("2026-09-22T02:07:00Z", [late]).shouldRun, false);
});

test("GitHub schedules one nightly run and accepts a gated match-window dispatch", async () => {
  // js-yaml is already installed by ESLint; no runtime dependency is added.
  const { load } = await import("js-yaml");
  const workflow = load(await readFile(new URL("../../.github/workflows/import-results.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on.schedule, [{ cron: DAILY_RESULTS_CRON, timezone: "Europe/Stockholm" }]);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.kind.options, ["full", "poll"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.slot_at.type, "string");
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
  assert.match(steps[gate].env.RESULTS_DISPATCH_KIND, /inputs\.kind/);
  assert.match(steps[gate].env.RESULTS_SLOT_AT, /inputs\.slot_at/);
  assert.deepEqual(Object.keys(workflow.jobs), ["import-results"]);
});

test("staging import rejects absent credentials and a production or malformed URL", () => {
  const valid = { supabaseUrl: "https://staging123.supabase.co", publicUrl: "https://staging123.supabase.co", serviceKey: "test", projectRef: "staging123", appEnv: "staging", stageId: "5727" };
  assert.doesNotThrow(() => verifyStagingImportTarget(valid));
  for (const fields of [
    { projectRef: "" }, { serviceKey: "" }, { appEnv: "production" }, { stageId: "-900001" },
    { supabaseUrl: "https://production456.supabase.co" },
    { publicUrl: "https://production456.supabase.co" },
    { supabaseUrl: "https://staging123.supabase.co:5432" },
    { supabaseUrl: "http://staging123.supabase.co" },
  ]) {
    assert.throws(() => verifyStagingImportTarget({ ...valid, ...fields }));
  }
});

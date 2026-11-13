import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const origins = ["https://www.pingisliganfantasy.se", "https://pingisliganfantasy.se"];
const source = await readFile(new URL("../../lib/analytics.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function loadAnalytics(origin, enabled = "true") {
  const exports = {};
  const calls = [];
  vm.runInNewContext(code, {
    exports, URL,
    process: { env: { NEXT_PUBLIC_ANALYTICS_ENABLED: enabled } },
    ...(origin ? { window: { location: { origin } } } : {}),
    require(name) {
      assert.equal(name, "@vercel/analytics");
      return { track: (...args) => calls.push(args) };
    },
  });
  return { ...exports, calls };
}

test("analytics enables both production origins and sends events without properties", () => {
  for (const origin of origins) {
    const analytics = loadAnalytics(origin);
    assert.equal(analytics.isAnalyticsEnabled(), true);
    analytics.trackAnalyticsEvent("Squad Save Clicked");
    assert.deepEqual(analytics.calls, [["Squad Save Clicked"]]);
  }
});

test("page views and events from either origin share canonical URLs with private data removed", () => {
  for (const browserOrigin of origins) {
    const analytics = loadAnalytics(browserOrigin);
    for (const eventOrigin of origins) {
      for (const type of ["pageview", "event"]) {
        for (const [path, expected] of [
          ["/", "/"],
          ["/en", "/en"],
          ["/dashboard/overview/", "/dashboard/overview"],
          ["/dashboard/leagues/private-league-id", "/dashboard/leagues/[leagueId]"],
          ["/competitions/gameweek/private-gameweek-id", "/competitions/gameweek/[gameweekId]"],
        ]) {
          const event = { type, url: `${eventOrigin}${path}?invite=secret#private-fragment` };
          const result = analytics.beforeSendAnalytics(event);
          assert.equal(result?.url, `https://www.pingisliganfantasy.se${expected}`);
          assert.equal(result.type, type);
          assert.equal(event.url, `${eventOrigin}${path}?invite=secret#private-fragment`);
        }
      }
    }
    for (const path of ["/unknown", "/api/players", "/auth/callback", "/dashboard/leagues/id/nested"]) {
      assert.equal(analytics.beforeSendAnalytics({ type: "pageview", url: `${browserOrigin}${path}` }), null);
    }
    assert.equal(analytics.beforeSendAnalytics({ type: "pageview", url: "invalid-url" }), null);
  }
});

test("non-production origins cannot load analytics, send events or supply tracked URLs", () => {
  for (const origin of [
    "http://localhost:3000", "http://127.0.0.1:3000",
    "https://preview.vercel.app", "https://staging.pingisliganfantasy.se",
    "http://www.pingisliganfantasy.se", "http://pingisliganfantasy.se",
    "https://www.pingisliganfantasy.se:8443", "https://www.pingisliganfantasy.se.example.com",
  ]) {
    const analytics = loadAnalytics(origin);
    assert.equal(analytics.isAnalyticsEnabled(), false);
    analytics.trackAnalyticsEvent("Squad Save Clicked");
    assert.equal(analytics.calls.length, 0);
    assert.equal(analytics.beforeSendAnalytics({ type: "pageview", url: `${origins[0]}/dashboard` }), null);
    assert.equal(loadAnalytics(origins[0]).beforeSendAnalytics({ type: "pageview", url: `${origin}/dashboard` }), null);
  }
});

test("the production flag and browser are still required on both production domains", () => {
  for (const origin of [...origins, undefined]) {
    for (const enabled of ["false", "", "true"]) {
      if (origin && enabled === "true") continue;
      const analytics = loadAnalytics(origin, enabled);
      assert.equal(analytics.isAnalyticsEnabled(), false);
      analytics.trackAnalyticsEvent("Squad Save Clicked");
      assert.equal(analytics.calls.length, 0);
      assert.equal(analytics.beforeSendAnalytics({ type: "pageview", url: `${origins[0]}/dashboard` }), null);
    }
  }
});

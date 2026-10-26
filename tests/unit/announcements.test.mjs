import assert from "node:assert/strict";
import test from "node:test";
import { popupCandidates, safeAnnouncementUrl } from "../../lib/announcements.ts";

const pending = [{ id: "urgent", priority: "high" }, { id: "ordinary", priority: "normal" }];
const checked_at = "2026-10-25T12:00:00Z";

test("High bypasses snooze; Normal resumes at the database-time boundary", () => {
  const summary = { pending, checked_at, snoozed_until: "2026-10-25T12:00:01Z" };
  assert.deepEqual(popupCandidates(summary).map((item) => item.id), ["urgent"]);
  assert.deepEqual(popupCandidates({ ...summary, snoozed_until: checked_at }), pending);
  assert.deepEqual(popupCandidates({ ...summary, snoozed_until: "2026-10-25T11:59:59Z" }), pending);
  assert.deepEqual(popupCandidates({ ...summary, snoozed_until: null }), pending);
  assert.deepEqual(popupCandidates({ ...summary, pending: [], snoozed_until: null }), []);
});

test("announcement links accept local paths and HTTPS while rejecting executable and ambiguous URLs", () => {
  for (const unsafe of [null, "", "javascript:alert(1)", "data:text/html,test", "//evil.invalid", "/\\evil.invalid", "http://example.com", "https://user:pass@example.com", " /dashboard", "/\n/evil.invalid", "/\u0001test"]) {
    assert.equal(safeAnnouncementUrl(unsafe), undefined, String(unsafe));
  }
  for (const safe of ["/", "/dashboard/rules", "/dashboard?tab=team#help", "https://example.com/prize"]) {
    assert.equal(safeAnnouncementUrl(safe), safe);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { safeAnnouncementUrl } from "../../lib/announcements.ts";

test("announcement links accept local paths and HTTPS while rejecting executable and ambiguous URLs", () => {
  for (const unsafe of [null, "", "javascript:alert(1)", "data:text/html,test", "//evil.invalid", "/\\evil.invalid", "http://example.com", "https://user:pass@example.com", " /dashboard", "/\n/evil.invalid", "/\u0001test"]) {
    assert.equal(safeAnnouncementUrl(unsafe), undefined, String(unsafe));
  }
  for (const safe of ["/", "/dashboard/rules", "/dashboard?tab=team#help", "https://example.com/prize"]) {
    assert.equal(safeAnnouncementUrl(safe), safe);
  }
});

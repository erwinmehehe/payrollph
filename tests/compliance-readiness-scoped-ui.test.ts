import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// These are lightweight source contracts. Request cancellation and out-of-scope
// result suppression are behavior-tested in scoped-async-request.test.ts.
const panels = [
  {
    path: "src/components/workspace/compliance-policy-review-panel.tsx",
    scope: '"compliance-policy-review:" + organizationId',
    route: "/api/compliance/policy-review?organizationId=",
  },
  {
    path: "src/components/workspace/launch-readiness-panel.tsx",
    scope: '"launch-readiness:" + organizationId',
    route: "/api/readiness/workspace?organizationId=",
  },
  {
    path: "src/components/workspace/compliance-calendar-panel.tsx",
    scope: '"compliance-calendar:" + organizationId',
    route: "/api/compliance/calendar?organizationId=",
  },
] as const;

test("read-only compliance and launch status panels use cancellable tenant-bound reads", () => {
  for (const panel of panels) {
    const source = readFileSync(panel.path, "utf8");
    assert.ok(source.includes("useScopedAsyncResource("), panel.path);
    assert.ok(source.includes(panel.scope), panel.path);
    if (panel.path.endsWith("compliance-calendar-panel.tsx")) {
      // Route/fetch and abort signal live in a pure tenant-bound verifier.
      const verified = readFileSync("src/lib/compliance-calendar-read.ts", "utf8");
      assert.match(source, /readVerifiedComplianceCalendar\(organizationId, fetch, signal\)/);
      assert.match(verified, /\/api\/compliance\/calendar\?organizationId=/);
      assert.match(verified, /cache: "no-store", signal/);
      assert.match(verified, /parseVerifiedComplianceCalendar\(value, organizationId\)/);
    } else {
      assert.ok(source.includes(panel.route), panel.path);
      assert.match(source, /async \(signal: AbortSignal\)/);
      assert.match(source, /cache: "no-store",\s+signal,/);
    }
    assert.match(source, /error: loadError, reload/);
    assert.match(source, /onClick=\{\(\) => void reload\(\)\}/);
    assert.doesNotMatch(source, /useEffect\s*\(/, "mount effects should not synchronously set state");
  }
});

test("resolved effect suppressions are absent without disabling the lint rule", () => {
  const suppressions = JSON.parse(readFileSync("eslint-suppressions.json", "utf8"));
  for (const panel of panels) {
    assert.equal(suppressions[panel.path], undefined, "resolved suppression must be removed");
  }
});

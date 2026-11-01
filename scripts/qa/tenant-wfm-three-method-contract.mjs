/**
 * No-credit WFM three-method candidate. Source/HTTP evidence is not release approval.
 * Both GET methods reuse separately reviewed executable proof runners.
 */
import assert from "node:assert/strict";
import { requireDisposableGreedyRoster } from "./tenant-wrk01-greedy-roster-contract.mjs";

export const WFM_THREE_METHODS = Object.freeze([
  "GET workforce/demand-staffing/policies",
  "GET workforce/greedy-roster",
  "POST workforce/roster-rules/preview",
]);
export const ROSTER_PREVIEW_ENDPOINT = "/api/workforce/roster-rules/preview";

export function requireDisposableWfmThreeMethods(env = process.env) {
  // Must run BEFORE any application or DB imports.
  requireDisposableGreedyRoster(env);
  assert.equal(env.TENANT_WFM_THREE_METHOD_MODE, "fictional-only",
    "WFM_THREE_METHODS_REFUSED: use the dedicated fictional-only CI job");
}

function wire(response) {
  assert.ok(response && typeof response.text === "string");
  const headers = response.headers;
  assert.ok(headers && typeof headers.entries === "function");
  return response.text + "\n" +
    [...headers.entries()].map(([name, value]) => name + ":" + value).join("\n");
}

export function assertNoOtherEmployerData(response, markers) {
  const content = wire(response);
  for (const marker of markers) {
    assert.ok(typeof marker === "string" && marker.length > 0,
      "every private marker must be a real seeded value");
    assert.ok(!content.includes(marker), "foreign employer source marker was disclosed");
  }
}

export function assertOwnedRosterPreview(response, employer, otherMarkers = []) {
  assert.equal(response?.status, 200,
    "real own POST preview must succeed, not a 404/409 or fabricated empty receipt: " +
      String(response?.text).slice(0, 160));
  const directives = String(response.headers.get("cache-control") || "")
    .toLowerCase().split(",").map(x => x.trim());
  assert.ok(directives.includes("no-store"), "preview must not be cached");
  assert.ok(!directives.some(x => x === "public" || x.startsWith("s-maxage=")),
    "preview cannot permit shared caching");
  const result = response.json;
  assert.ok(result && typeof result === "object" && !Array.isArray(result));
  assert.deepEqual(Object.keys(result).sort(),
    ["ruleFindings", "guardrailIssues", "blocked", "canOverrideCodes", "policy", "message"].sort());
  assert.ok(Array.isArray(result.ruleFindings), "actual roster rules were evaluated");
  assert.ok(Array.isArray(result.guardrailIssues), "actual guardrails were evaluated");
  assert.ok(Array.isArray(result.canOverrideCodes), "real rule decision must be present");
  assert.equal(typeof result.blocked, "boolean");
  assert.equal(result.message,
    "Preview only. No shift, payroll entry or approval was created.");
  assert.deepEqual(result.policy, {
    active: true,
    maxDailyMinutes: employer.maxDailyMinutes,
    maxRollingSevenDayMinutes: 2880,
    minRestBetweenShiftsMinutes: 660,
    ordinaryDailyMinutes: 480,
    approvedOvertimeCapMinutes: 0,
    enforcementMode: employer.enforcementMode,
  }, "must return exact SQL policy of the signed-in employer, not a default or foreign policy");
  assertNoOtherEmployerData(response, otherMarkers);
}

export function assertDeniedRosterPreview(response, status, otherMarkers = []) {
  assert.equal(response?.status, status,
    "foreign/unauthorized POST must be explicitly denied: " +
      String(response?.text).slice(0, 160));
  assert.ok(typeof response?.json?.error === "string" && response.json.error.length < 240,
    "denial must have a bounded, non-sensitive error");
  for (const key of ["ruleFindings", "guardrailIssues", "policy", "blocked", "canOverrideCodes"]) {
    assert.equal(response.json[key], undefined,
      "denied request must not return private roster evidence: " + key);
  }
  assert.ok(response.text.length < 1500, "denial cannot return an internal diagnostic");
  assert.ok(!/\b(?:SELECT\s+.+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET)\b/i.test(response.text),
    "SQL content exposed on denied request");
  assert.ok(!/node_modules|postgresql:|drizzle|stack trace/i.test(response.text),
    "internal exception details exposed on denied request");
  assertNoOtherEmployerData(response, otherMarkers);
}

export function assertRosterPreviewImmutable(before, after, label) {
  assert.deepEqual(after, before,
    label + ": roster preview/denial must not mutate employee, scheduling, audit or payroll SQL");
}

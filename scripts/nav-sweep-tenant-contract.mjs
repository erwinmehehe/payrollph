/**
 * Read-only, zero-credit cross-employer navigation proof contracts.
 * This does NOT reclassify page/action GAPs or substitute for a role browser run.
 */
import assert from "node:assert/strict";

export const NAV_TENANT_ORIGIN = "http://127.0.0.1:3000";

// Manifest entries are untrusted inventory data, never HTTP destinations.
// Only these exact reviewed local page routes may become outbound requests.
export const NAV_TENANT_ROUTE_BY_FILE = Object.freeze({
  "src/app/app/engagement/page.tsx": "/app/engagement",
  "src/app/app/goals-reviews/page.tsx": "/app/goals-reviews",
  "src/app/app/page.tsx": "/app",
  "src/app/billing/setup/page.tsx": "/billing/setup",
  "src/app/careers/page.tsx": "/careers",
  "src/app/hcm/action-center/page.tsx": "/hcm/action-center",
  "src/app/hcm/command-center/page.tsx": "/hcm/command-center",
  "src/app/hcm/hire-payroll-review/page.tsx": "/hcm/hire-payroll-review",
  "src/app/hcm/hr-cases/page.tsx": "/hcm/hr-cases",
  "src/app/hcm/manager-decision-inbox/page.tsx": "/hcm/manager-decision-inbox",
  "src/app/hcm/manager-direct-reports/page.tsx": "/hcm/manager-direct-reports",
  "src/app/hcm/my-team/page.tsx": "/hcm/my-team",
  "src/app/hcm/org-explorer/page.tsx": "/hcm/org-explorer",
  "src/app/hcm/process-monitor/page.tsx": "/hcm/process-monitor",
  "src/app/hcm/team-leave-calendar/page.tsx": "/hcm/team-leave-calendar",
  "src/app/hcm/work-items/page.tsx": "/hcm/work-items",
  "src/app/hcm/worker-360/page.tsx": "/hcm/worker-360",
  "src/app/self/schedule-receipts/page.tsx": "/self/schedule-receipts",
  "src/app/workspace/2316/page.tsx": "/workspace/2316",
  "src/app/workspace/prior-employer/page.tsx": "/workspace/prior-employer",
  "src/app/workspace/report-builder/page.tsx": "/workspace/report-builder",
});


export function requireDisposableNavTenantEnv(env = process.env) {
  assert.equal(env.CI, "true", "NAV_TENANT_REFUSED: CI-only");
  assert.equal(env.BUILD_BLOCK_ACCEPTANCE_MODE, "synthetic-postgres-only",
    "NAV_TENANT_REFUSED: disposable browser fixture required");
  assert.equal(env.NODE_ENV, "production", "NAV_TENANT_REFUSED: production-mode local server required");
  assert.equal(env.DEMO_MODE, "false", "NAV_TENANT_REFUSED: no public demo switch");
  assert.equal(env.APP_BASE_URL, "https://127.0.0.1:3000", "NAV_TENANT_REFUSED: exact synthetic metadata origin");
  assert.equal(env.TRUSTED_APP_ORIGINS, NAV_TENANT_ORIGIN,
    "NAV_TENANT_REFUSED: exact local request origin");
  assert.equal(env.OPENAI_API_KEY ?? "", "", "NAV_TENANT_REFUSED: no external model token");
  const database = new URL(env.DATABASE_URL ?? "");
  assert.equal(database.protocol, "postgresql:");
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "5432");
  assert.equal(database.pathname, "/app_db");
  assert.equal(database.username, "postgres");
  for (const key of ["WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "XENDIT_BILLING_ENABLED"]) {
    assert.equal(env[key], "false", "NAV_TENANT_REFUSED: " + key);
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "RESEND_API_KEY", "STRIPE_SECRET_KEY", "SMTP_PASSWORD"]) {
    assert.ok(!env[key], "NAV_TENANT_REFUSED: provider credential " + key);
  }
}

export function tenantNavPageUrl(file, id) {
  assert.ok(typeof file === "string" && Object.hasOwn(NAV_TENANT_ROUTE_BY_FILE, file),
    "NAV_TENANT_REFUSED: only reviewed scoped page routes may be requested");
  assert.ok(Number.isSafeInteger(id) && id > 0, "Actual positive employer ID required");
  return NAV_TENANT_ROUTE_BY_FILE[file] + "?organizationId=" + id;
}

// Drop network taint before writing receipts: only approved literal HTTP codes.
// Any unexpected status fails closed rather than persisting untrusted input.
export function navReceiptStatus(status) {
  switch (status) {
    case 200: return 200;
    case 201: return 201;
    case 202: return 202;
    case 204: return 204;
    case 301: return 301;
    case 302: return 302;
    case 303: return 303;
    case 307: return 307;
    case 308: return 308;
    case 400: return 400;
    case 401: return 401;
    case 403: return 403;
    case 404: return 404;
    case 405: return 405;
    case 409: return 409;
    case 410: return 410;
    case 422: return 422;
    case 429: return 429;
    default: assert.fail("NAV_TENANT_REFUSED: unexpected HTTP status for receipt");
  }
}

export function requireRealEmployerTrio(subjects) {
  assert.ok(Array.isArray(subjects) && subjects.length === 3,
    "Two independent attackers and a separate populated victim are required");
  assert.deepEqual(subjects.map(s => s.label), ["ATTA", "ATTB", "VICTIM"],
    "Real SQL fixture insertion order must put the victim last");
  const uniqueCookies = new Set();
  const uniqueMarkers = new Set();
  for (const employer of subjects) {
    for (const key of ["orgId", "ownerId", "employeeId", "payrollId"]) {
      assert.ok(Number.isSafeInteger(employer[key]) && employer[key] > 0,
        "A real persisted own row ID is required: " + key);
    }
    assert.ok(typeof employer.ownerCookie === "string" &&
      employer.ownerCookie.startsWith("__Host-linaw_session="),
      "Real own owner session required");
    assert.ok(typeof employer.employeeCookie === "string" &&
      employer.employeeCookie.startsWith("__Host-linaw_session="),
      "Real own employee session required");
    assert.notEqual(employer.ownerCookie, employer.employeeCookie);
    uniqueCookies.add(employer.ownerCookie);
    uniqueCookies.add(employer.employeeCookie);
    assert.ok(typeof employer.marker === "string" && employer.marker.startsWith("TTBL-"));
    assert.ok(employer.privateEmployeeNo.includes(employer.marker));
    assert.ok(employer.privatePayrollPeriod.includes(employer.marker));
    uniqueMarkers.add(employer.marker);
  }
  assert.equal(uniqueCookies.size, 6, "No session may be shared across test subjects");
  assert.equal(uniqueMarkers.size, 3, "No employer marker may be reused");
  const [attackerA, attackerB, victim] = subjects;
  for (const attacker of [attackerA, attackerB]) {
    for (const key of ["orgId", "ownerId", "employeeId", "payrollId"]) {
      assert.ok(victim[key] > attacker[key],
        "Victim must be an actual higher-ID persisted " + key);
    }
  }
}

export function inspectNavPage({ file, own, foreign, actor, victim }) {
  for (const [label, response] of [["own", own], ["foreign", foreign]]) {
    assert.ok(response && Number.isInteger(response.status) && response.status >= 200 &&
      response.status < 500, file + " " + label + " must never return 5xx or lack real HTTP");
    assert.equal(typeof response.text, "string",
      file + " " + label + " must have the real HTTP body");
    assert.equal(typeof response.contentType, "string");
  }
  assert.ok(!foreign.text.includes(victim.privateEmployeeNo),
    file + " must not expose the real victim-only employee ID");
  assert.ok(!foreign.text.includes(victim.privatePayrollPeriod),
    file + " must not expose the victim payroll period");
  if (file !== "src/app/careers/page.tsx") {
    assert.ok(!foreign.text.includes(victim.marker),
      file + " must not expose the victim's fictional private business marker");
  }
  if (file !== "src/app/careers/page.tsx") {
    assert.ok(!foreign.text.includes(victim.orgName),
      file + " must not render the victim's employer name");
  }
  if (file === "src/app/app/page.tsx") {
    assert.equal(own.status, 200, "Actual own workspace must succeed");
    assert.match(own.contentType, /text\/html/i, "Actual own SSR HTML required");
    assert.ok(own.text.includes(actor.orgName) &&
      own.text.includes(actor.privateEmployeeNo),
      "Own SSR must contain a persisted employer and actual owned employee");
    assert.ok(!own.text.includes("Workspace unavailable"),
      "An HTTP 200 error shell is not a successful own workspace");
    assert.equal(foreign.status, 404,
      "An attacker-supplied actual foreign organizationId must be rejected");
  }
  return {
    file, attacker: actor.label,
    ownStatus: navReceiptStatus(own.status), foreignStatus: navReceiptStatus(foreign.status),
    ownPopulated: file === "src/app/app/page.tsx",
    foreignDenied: [302, 303, 307, 308, 401, 403, 404].includes(navReceiptStatus(foreign.status)),
    methodCredited: false, pageCredited: false,
  };
}

export function assertReadOnlySnapshot(before, after, why) {
  assert.deepEqual(after, before,
    why + ": no employer payroll, employees, staffing, outbox, membership, or audit business record may change");
}

export function verifyNavCoverage(manifest, observations) {
  assert.ok(Array.isArray(manifest?.scopedPages) && manifest.scopedPages.length === 21,
    "All 21 currently enumerated scoped pages/actions must be probed");
  assert.deepEqual(manifest.scopedPages.map(p => p.path).sort(),
    Object.keys(NAV_TENANT_ROUTE_BY_FILE).sort(),
    "Manifest drift requires review of the exact outbound localhost route allowlist");
  assert.ok(manifest.scopedPages.some(p => p.status === "GAP"),
    "A default-off page cannot be silently awarded new coverage");
  assert.equal(observations.length, manifest.scopedPages.length * 2);
  const expected = new Set();
  for (const page of manifest.scopedPages) for (const attacker of ["ATTA", "ATTB"])
    expected.add(page.path + ":" + attacker);
  const seen = new Set();
  for (const row of observations) {
    const key = row.file + ":" + row.attacker;
    assert.ok(expected.has(key) && !seen.has(key), "Missing, duplicate or invented scoped page: " + key);
    assert.equal(row.pageCredited, false, "Navigation probe never promotes page GAP");
    assert.equal(row.methodCredited, false);
    seen.add(key);
  }
  assert.equal(seen.size, expected.size);
  return {
    manifestScopedPages: manifest.scopedPages.length,
    remainingPageGaps: manifest.scopedPages.filter(p => p.status === "GAP").length,
    methodCreditDelta: 0, pageCreditDelta: 0,
    actualIndependentAttackers: 2,
    realOwnForeignPageComparisons: observations.length,
    ownedWorkspacePositiveChecks: observations.filter(r =>
      r.file === "src/app/app/page.tsx" && r.ownPopulated).length,
    fullPageAuthorizationAccepted: false,
    productionCertified: false,
  };
}

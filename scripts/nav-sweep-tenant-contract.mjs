/**
 * Read-only, zero-credit cross-employer navigation proof contracts.
 * This does NOT reclassify page/action GAPs or substitute for a role browser run.
 */
import assert from "node:assert/strict";

export const NAV_TENANT_ORIGIN = "http://127.0.0.1:3000";

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
  assert.match(file, /^src\/app(?:\/[a-zA-Z0-9_-]+)+\/page\.tsx$/,
    "Explicit literal route required, never infer a dynamic business-ID path");
  assert.ok(Number.isSafeInteger(id) && id > 0, "Actual positive employer ID required");
  const route = file.slice("src/app".length, -"/page.tsx".length);
  assert.ok(route.startsWith("/") && !route.includes("[") && !route.includes("]"));
  return route + "?organizationId=" + id;
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
    ownStatus: own.status, foreignStatus: foreign.status,
    ownPopulated: file === "src/app/app/page.tsx",
    foreignDenied: [302, 303, 307, 308, 401, 403, 404].includes(foreign.status),
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

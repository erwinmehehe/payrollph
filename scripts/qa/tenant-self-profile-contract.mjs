import assert from "node:assert/strict";

/**
 * Synthetic, real-HTTP verification for PATCH /api/self/profile.
 * No source-only assertion counts as a tenant-isolation method credit.
 */
export function requireDisposableSelfProfile(env = process.env) {
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL ?? "");
    database = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("ESS_PROFILE_REFUSED: explicit disposable URLs required");
  }
  const safe = env.CI === "true"
    && env.TENANT_SECOND_PASS_MODE === "isolated-ci-only"
    && env.NODE_ENV === "production"
    && app.href === "http://127.0.0.1:3000/"
    && database.protocol === "postgresql:"
    && database.hostname === "127.0.0.1"
    && database.port === "5432"
    && database.pathname === "/app_db"
    && database.username === "postgres"
    && env.WORKER_ENABLED === "false"
    && env.CENTRAL_SCHEDULER_ENABLED === "false"
    && env.PAYMONGO_DISBURSEMENTS_ENABLED === "false"
    && env.XENDIT_PAYOUTS_ENABLED === "false"
    && env.XENDIT_BILLING_ENABLED === "false"
    && env.DEMO_MODE !== "true"
    && !env.PAYMONGO_SECRET_KEY
    && !env.XENDIT_SECRET_KEY
    && !env.XENDIT_PAYOUT_SECRET_KEY
    && !env.RESEND_API_KEY
    && !env.POSTMARK_SERVER_TOKEN
    && !env.SMTP_URL;
  assert.ok(safe, "ESS_PROFILE_REFUSED: only fictional PG16/localhost with providers disabled");
  return true;
}

export function assertNoProfileMarker(response, marker) {
  assert.ok(typeof marker === "string" && marker.length > 6, "private sentinel must be discriminating");
  assert.ok(!String(response.text ?? "").includes(marker), "private employee marker in response body");
  for (const [name, value] of response.headers?.entries?.() ?? []) {
    assert.ok(!(name + ": " + value).includes(marker), "private employee marker in response headers");
  }
}

export function assertProfileDenied(response, status, markers = []) {
  assert.equal(response.status, status, "expected an exact signed-in authorization/error status");
  assert.ok(response.json && typeof response.json.error === "string", "denial needs a real error response");
  assert.ok(!Object.hasOwn(response.json, "profile"), "denied request cannot expose an employee profile");
  for (const marker of markers) assertNoProfileMarker(response, marker);
}

export function assertOwnProfileMutation(before, after, actor, response, expected) {
  assert.equal(response.status, 200, "signed-in employee PATCH must really succeed");
  assert.deepEqual(Object.keys(response.json ?? {}), ["profile"],
    "PATCH must return only the editable profile envelope");
  assert.deepEqual(response.json.profile, expected,
    "response must reflect exact persisted own contact fields, not a fabricated success");
  for (const key of ["payroll", "payProfiles", "punches", "orgUnits", "legalEntities"]) {
    assert.deepEqual(after[key], before[key], key + " cannot be rewritten by an employee contact edit");
  }
  assert.ok(before.employees.length >= 2, "real own and coworker rows required");
  const id = actor.worker.id;
  const orgId = actor.org.id;
  const ownBefore = before.employees.find(row => row.id === id);
  const ownAfter = after.employees.find(row => row.id === id);
  assert.ok(ownBefore && ownAfter && ownBefore.organizationId === orgId,
    "session-bound employee must be a persisted row in the claimed employer");
  assert.deepEqual(ownAfter, { ...ownBefore, ...expected },
    "only the three own contact columns may change");
  assert.deepEqual(after.employees.filter(row => row.id !== id),
    before.employees.filter(row => row.id !== id),
    "same-company coworker and all other employee records must remain byte-for-byte equal");
  assert.equal(after.audit.length, before.audit.length + 1, "one audit receipt per successful contact PATCH");
  const added = after.audit.filter(row => !before.audit.some(previous => previous.id === row.id));
  assert.equal(added.length, 1, "audit receipt must be a real new persisted row");
  assert.deepEqual(after.audit.filter(row => row.id !== added[0].id), before.audit,
    "previously persisted audit records must not be altered");
  assert.equal(added[0].organizationId, orgId, "audit must belong to the employee's true employer");
  assert.equal(added[0].actor, actor.ess.name, "audit must identify the signed-in employee");
  assert.equal(added[0].action, "Employee self-service profile updated");
  assert.equal(added[0].resource, actor.worker.employeeNo);
  assert.deepEqual(added[0].metadata, {
    employeeId: id,
    fields: ["mobile", "emergencyContact", "emergencyPhone"],
    payrollSensitiveFieldsChanged: false,
  });
  return ownAfter;
}

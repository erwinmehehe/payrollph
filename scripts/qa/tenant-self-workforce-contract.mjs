import assert from "node:assert/strict";

// One real, pre-published shift record per employee. No payroll decisions.
export const SELF_WORKFORCE_DATE = "2026-03-03";
export const ORIGINAL_IN = "2026-03-03T01:00:00.000Z";
export const PROPOSED_IN = "2026-03-03T00:45:00.000Z";
export const ORIGINAL_OUT = "2026-03-03T09:00:00.000Z";

export function requireDisposableSelfWorkforce(env = process.env) {
  let app, pg;
  try {
    app = new URL(env.SECURITY_SMOKE_URL ?? "");
    pg = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("ESS_WORKFORCE_REFUSED: explicit local URLs required");
  }
  const safe = env.CI === "true"
    && env.TENANT_SECOND_PASS_MODE === "isolated-ci-only"
    && env.NODE_ENV === "production"
    && app.href === "http://127.0.0.1:3000/"
    && pg.protocol === "postgresql:"
    && pg.hostname === "127.0.0.1"
    && pg.port === "5432"
    && pg.pathname === "/app_db"
    && pg.username === "postgres"
    && env.PAYMONGO_DISBURSEMENTS_ENABLED === "false"
    && env.XENDIT_PAYOUTS_ENABLED === "false"
    && env.XENDIT_BILLING_ENABLED === "false"
    && !env.PAYMONGO_SECRET_KEY && !env.XENDIT_SECRET_KEY
    && !env.XENDIT_PAYOUT_SECRET_KEY
    && !env.RESEND_API_KEY && !env.POSTMARK_SERVER_TOKEN && !env.SMTP_URL;
  assert.ok(safe, "ESS_WORKFORCE_REFUSED: use only empty fictional PG16, localhost and disabled providers");
  return true;
}

export function assertNoPrivateMarker(response, marker) {
  assert.ok(typeof marker === "string" && marker.length > 6, "a real distinguishing sentinel is mandatory");
  assert.ok(!String(response.text ?? "").includes(marker), "private employer marker leaked in response body");
  const headers = response.headers;
  if (headers?.entries) {
    for (const [key, value] of headers.entries()) {
      assert.ok(!(key + ":" + value).includes(marker), "private employer marker leaked in response headers");
    }
  }
}

export function assertWorkforceOwnRead(response, actor, expectedCorrectionIds = []) {
  assert.equal(response.status, 200, "a real employee must receive HTTP 200");
  const data = response.json;
  assert.ok(data && typeof data === "object" && !Array.isArray(data));
  assert.deepEqual(data.range, { startDate: SELF_WORKFORCE_DATE, endDate: SELF_WORKFORCE_DATE });
  assert.equal(data.employee?.id, actor.worker.id);
  assert.equal(data.employee?.employeeNo, actor.worker.employeeNo);
  assert.equal(data.employee?.name, actor.worker.firstName + " " + actor.worker.lastName);
  assert.ok(Array.isArray(data.schedule) && data.schedule.length === 1, "one real daily schedule window required");
  assert.ok(Array.isArray(data.punches) && data.punches.length === 1, "no empty or peer/victim punch response");
  assert.equal(data.punches[0].id, actor.punch.id);
  assert.equal(data.punches[0].workDate, SELF_WORKFORCE_DATE);
  assert.equal(data.punches[0].timeIn, ORIGINAL_IN);
  assert.equal(data.punches[0].timeOut, ORIGINAL_OUT);
  assert.equal(data.punches[0].status, "Complete");
  assert.ok(Array.isArray(data.corrections), "the own correction collection must exist");
  assert.deepEqual(data.corrections.map(row => row.id).sort((a, b) => a - b),
    [...expectedCorrectionIds].sort((a, b) => a - b),
    "only the exact owned corrections may be returned");
  for (const correction of data.corrections) {
    assert.equal(correction.organizationId, actor.org.id);
    assert.equal(correction.employeeId, actor.worker.id);
    assert.equal(correction.punchId, actor.punch.id);
    assert.equal(correction.status, "pending");
  }
}

export function assertOwnCorrectionMutation(before, after, actor, response) {
  for (const table of ["punches", "employees", "schedules", "overrides", "payroll"]) {
    assert.deepEqual(after[table], before[table], table + " must not be rewritten by a correction request");
  }
  assert.equal(after.corrections.length, before.corrections.length + 1, "only one pending correction may be added");
  const added = after.corrections.filter(row => !before.corrections.some(old => old.id === row.id));
  assert.equal(added.length, 1, "one persisted correction row required");
  const correction = added[0];
  assert.ok(Number.isSafeInteger(correction.id) && correction.id > 0);
  assert.equal(correction.organizationId, actor.org.id);
  assert.equal(correction.employeeId, actor.worker.id);
  assert.equal(correction.punchId, actor.punch.id);
  assert.equal(correction.workDate, SELF_WORKFORCE_DATE);
  assert.equal(correction.requestedBy, actor.ess.name);
  assert.equal(correction.requestedByUserId, actor.ess.id);
  assert.equal(correction.reason, actor.reason);
  assert.equal(correction.status, "pending");
  assert.equal(correction.decidedByUserId, null);
  assert.equal(correction.decidedAt, null);
  assert.equal(correction.appliedAt, null);
  assert.deepEqual(correction.invalidatedPayrollRunIds, []);
  assert.deepEqual(correction.originalPunchSnapshot, {
    workDate: SELF_WORKFORCE_DATE, timeIn: ORIGINAL_IN, timeOut: ORIGINAL_OUT,
    breakStart: null, breakEnd: null, status: "Complete",
  });
  assert.deepEqual(correction.proposedPunchSnapshot, {
    ...correction.originalPunchSnapshot, timeIn: PROPOSED_IN,
  });
  assert.deepEqual(after.corrections.filter(row => row.id !== correction.id), before.corrections,
    "other pending and historical corrections must remain unchanged");
  assert.equal(response.status, 201);
  assert.equal(response.json?.correction?.id, correction.id);
  assert.equal(response.json?.correction?.organizationId, actor.org.id);
  assert.equal(response.json?.correction?.employeeId, actor.worker.id);
  assert.equal(response.json?.correction?.status, "pending");

  assert.equal(after.audit.length, before.audit.length + 1, "one new business audit event required");
  const events = after.audit.filter(event => !before.audit.some(old => old.id === event.id));
  assert.equal(events.length, 1);
  assert.deepEqual(after.audit.filter(event => event.id !== events[0].id), before.audit,
    "prior audit history must stay untouched");
  const audit = events[0];
  assert.equal(audit.organizationId, actor.org.id);
  assert.equal(audit.actor, actor.ess.name);
  assert.equal(audit.action, "Employee self-service attendance correction requested");
  assert.equal(audit.resource, actor.worker.employeeNo + " · " + SELF_WORKFORCE_DATE);
  assert.deepEqual(audit.metadata, {
    attendanceCorrectionRequestId: correction.id,
    employeeId: actor.worker.id, punchId: actor.punch.id,
    originalPunchSnapshot: correction.originalPunchSnapshot,
    proposedPunchSnapshot: correction.proposedPunchSnapshot,
    approvalRequired: true, payrollMutationPerformed: false,
  });
  return correction;
}

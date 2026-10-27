import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableSelfWorkforce, assertNoPrivateMarker,
  assertWorkforceOwnRead, assertOwnCorrectionMutation,
  SELF_WORKFORCE_DATE, ORIGINAL_IN, ORIGINAL_OUT, PROPOSED_IN,
} from "../scripts/qa/tenant-self-workforce-contract.mjs";

const safe = Object.freeze({
  CI: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only", NODE_ENV: "production",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", XENDIT_PAYOUT_SECRET_KEY: "",
  RESEND_API_KEY: "", POSTMARK_SERVER_TOKEN: "", SMTP_URL: "",
});
const actor = {
  org: { id: 11 }, worker: { id: 21, employeeNo: "SELF-A-21",
    firstName: "Fictional", lastName: "Worker" },
  punch: { id: 31 }, ess: { id: 41, name: "Fictional ESS actor" },
  reason: "Fictional employee requests correction to their own time punch",
};

function readResponse(correctionIds = []) {
  return {
    status: 200, text: JSON.stringify({ employee: actor.worker }),
    headers: new Headers(),
    json: {
      range: { startDate: SELF_WORKFORCE_DATE, endDate: SELF_WORKFORCE_DATE },
      employee: { id: actor.worker.id, employeeNo: actor.worker.employeeNo,
        name: actor.worker.firstName + " " + actor.worker.lastName },
      schedule: [{ date: SELF_WORKFORCE_DATE, isRestDay: true }],
      punches: [{ id: actor.punch.id, workDate: SELF_WORKFORCE_DATE,
        timeIn: ORIGINAL_IN, timeOut: ORIGINAL_OUT, status: "Complete" }],
      corrections: correctionIds.map(id => ({
        id, organizationId: actor.org.id, employeeId: actor.worker.id,
        punchId: actor.punch.id, status: "pending",
      })),
    },
  };
}

function mutationEvidence() {
  const original = { workDate: SELF_WORKFORCE_DATE,
    timeIn: ORIGINAL_IN, timeOut: ORIGINAL_OUT,
    breakStart: null, breakEnd: null, status: "Complete" };
  const before = {
    punches: [{ id: 31, organizationId: 11, employeeId: 21, timeIn: ORIGINAL_IN },
      { id: 32, organizationId: 11, employeeId: 22, timeIn: ORIGINAL_IN }],
    corrections: [{ id: 50, organizationId: 11, employeeId: 22, reason: "PRIVATE PEER" }],
    employees: [{ id: 21, organizationId: 11, employeeNo: "SELF-A-21" }],
    schedules: [], overrides: [], payroll: [],
    audit: [{ id: 70, organizationId: 11, action: "Old audit", resource: "old", metadata: {} }],
  };
  const after = structuredClone(before);
  const correction = {
    id: 90, organizationId: 11, employeeId: 21, punchId: 31,
    workDate: SELF_WORKFORCE_DATE, status: "pending",
    reason: actor.reason, requestedBy: actor.ess.name, requestedByUserId: 41,
    decidedByUserId: null, decidedAt: null, appliedAt: null,
    invalidatedPayrollRunIds: [], originalPunchSnapshot: original,
    proposedPunchSnapshot: { ...original, timeIn: PROPOSED_IN },
  };
  after.corrections.push(correction);
  after.audit.push({
    id: 71, organizationId: 11, actor: actor.ess.name,
    action: "Employee self-service attendance correction requested",
    resource: actor.worker.employeeNo + " · " + SELF_WORKFORCE_DATE,
    metadata: {
      attendanceCorrectionRequestId: 90, employeeId: 21, punchId: 31,
      originalPunchSnapshot: original, proposedPunchSnapshot: correction.proposedPunchSnapshot,
      approvalRequired: true, payrollMutationPerformed: false,
    },
  });
  return { before, after, response: {
    status: 201, json: { correction: { id: 90, organizationId: 11,
      employeeId: 21, status: "pending" } },
  } };
}

test("hard fail-closed guard accepts only exact synthetic localhost PG16 and disabled providers", () => {
  assert.equal(requireDisposableSelfWorkforce(safe), true);
  const invalid = [
    ["CI", "false"], ["TENANT_SECOND_PASS_MODE", "live"],
    ["NODE_ENV", "development"], ["SECURITY_SMOKE_URL", "https://payroll.example.test"],
    ["SECURITY_SMOKE_URL", "http://localhost:3000"],
    ["SECURITY_SMOKE_URL", "http://127.0.0.1.evil:3000"],
    ["DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5433/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/production"],
    ["DATABASE_URL", "postgresql://other:secret@127.0.0.1:5432/app_db"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"], ["PAYMONGO_SECRET_KEY", "secret"],
    ["XENDIT_SECRET_KEY", "secret"], ["XENDIT_PAYOUT_SECRET_KEY", "secret"],
    ["RESEND_API_KEY", "secret"], ["POSTMARK_SERVER_TOKEN", "secret"],
    ["SMTP_URL", "smtp://mail.example.invalid"],
  ];
  for (const [name, value] of invalid) {
    assert.throws(() => requireDisposableSelfWorkforce({ ...safe, [name]: value }),
      /ESS_WORKFORCE_REFUSED/, name);
  }
  assert.throws(() => requireDisposableSelfWorkforce({ ...safe, DATABASE_URL: undefined }),
    /ESS_WORKFORCE_REFUSED/);
});

test("only a real nonempty own employee GET with its exact punch/corrections is evidence", () => {
  assertWorkforceOwnRead(readResponse(), actor);
  assertWorkforceOwnRead(readResponse([90]), actor, [90]);
  const corruptions = [
    r => { r.json.employee.id = 999; },
    r => { r.json.employee.employeeNo = "FOREIGN"; },
    r => { r.json.punches = []; },
    r => { r.json.punches.push({ ...r.json.punches[0], id: 999 }); },
    r => { r.json.punches[0].id = 999; },
    r => { r.json.punches[0].status = "Applied"; },
    r => { r.json.corrections = [{ id: 999, organizationId: 91, employeeId: 999 }]; },
    r => { r.json.schedule = []; },
    r => { r.status = 403; },
  ];
  for (const change of corruptions) {
    const evidence = readResponse(); change(evidence);
    assert.throws(() => assertWorkforceOwnRead(evidence, actor));
  }
});

test("private marker checks reject response-body AND response-header disclosures", () => {
  const clean = { text: "No private employee information", headers: new Headers() };
  assertNoPrivateMarker(clean, "VICTIM-FICTIONAL-PRIVATE");
  assert.throws(() => assertNoPrivateMarker({
    ...clean, text: "VICTIM-FICTIONAL-PRIVATE",
  }, "VICTIM-FICTIONAL-PRIVATE"));
  assert.throws(() => assertNoPrivateMarker({
    ...clean, headers: new Headers({ "x-private": "VICTIM-FICTIONAL-PRIVATE" }),
  }, "VICTIM-FICTIONAL-PRIVATE"));
});

test("own correction proves exactly one pending request, immutable punch/payroll and actor audit", () => {
  const evidence = mutationEvidence();
  const correction = assertOwnCorrectionMutation(evidence.before, evidence.after, actor, evidence.response);
  assert.equal(correction.id, 90);
});

test("negative controls reject no-op, forged worker/tenant, changed punch/peer/payroll and extra writes", () => {
  const changes = [
    x => { x.after = structuredClone(x.before); },
    x => { x.after.corrections[1].employeeId = 999; },
    x => { x.after.corrections[1].organizationId = 91; },
    x => { x.after.corrections[1].requestedByUserId = 999; },
    x => { x.after.corrections[1].punchId = 999; },
    x => { x.after.corrections[1].status = "approved"; },
    x => { x.after.corrections[1].appliedAt = "2026-03-03T10:00:00Z"; },
    x => { x.after.corrections[1].reason = "Changed"; },
    x => { x.after.corrections[1].proposedPunchSnapshot.timeIn = ORIGINAL_IN; },
    x => { x.after.corrections.push({ ...x.after.corrections[1], id: 91 }); },
    x => { x.after.corrections[0].reason = "peer record edited"; },
    x => { x.after.punches[0].timeIn = PROPOSED_IN; },
    x => { x.after.punches[1].employeeId = 999; },
    x => { x.after.payroll.push({ id: 999 }); },
    x => { x.response.json.correction.id = 999; },
  ];
  for (const modify of changes) {
    const e = mutationEvidence(); modify(e);
    assert.throws(() => assertOwnCorrectionMutation(e.before, e.after, actor, e.response));
  }
});

test("negative controls reject fabricated or foreign audit trails", () => {
  const changes = [
    x => { x.after.audit.pop(); },
    x => { x.after.audit[0].resource = "rewritten"; },
    x => { x.after.audit[1].organizationId = 91; },
    x => { x.after.audit[1].actor = "Foreign"; },
    x => { x.after.audit[1].action = "Attendance punch applied"; },
    x => { x.after.audit[1].metadata.payrollMutationPerformed = true; },
    x => { x.after.audit[1].metadata.employeeId = 999; },
    x => { x.after.audit.push({ ...x.after.audit[1], id: 99 }); },
  ];
  for (const modify of changes) {
    const e = mutationEvidence(); modify(e);
    assert.throws(() => assertOwnCorrectionMutation(e.before, e.after, actor, e.response));
  }
});

test("source keeps worker identity session-bound, membership checked and pending-only corrections", () => {
  const source = readFileSync("src/app/api/self/workforce/route.ts", "utf8");
  assert.match(source, /session\.role !== "employee" \|\| !session\.employeeId/);
  assert.match(source, /assertMembership\(session\.id, employee\.organizationId\)/);
  assert.match(source, /eq\(timePunches\.organizationId, employee\.organizationId\)/);
  assert.match(source, /eq\(timePunches\.employeeId, employee\.id\)/);
  assert.match(source, /eq\(attendanceCorrectionRequests\.organizationId, employee\.organizationId\)/);
  assert.match(source, /eq\(attendanceCorrectionRequests\.employeeId, employee\.id\)/);
  assert.match(source, /eq\(timePunches\.id, punchId\)/);
  assert.match(source, /enforceSameOriginMutation\(request\)/);
  assert.match(source, /publicDemoMutationDenied\(/);
  assert.match(source, /normalizeAttendanceCorrection\(/);
  assert.match(source, /recordAuditEvent\(/);
  assert.doesNotMatch(source, /db\.update\(timePunches\)/);
});

test("both methods stay GAP with no invented evidence or manifest edits", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const methods = manifest.allApiRouteFiles["src/app/api/self/workforce/route.ts"].methods;
  assert.deepEqual(methods.map(x => [x.name, x.status, x.testedBy ?? null]),
    [["GET", "GAP", null], ["POST", "GAP", null]]);
});

test("focused workflow is executable PG16/HTTP, not a source-only or live-provider proof", () => {
  const workflow = readFileSync(".github/workflows/tenant-self-workforce-http.yml", "utf8");
  const runner = readFileSync("scripts/qa/tenant-self-workforce-http.mjs", "utf8");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm run db:push/);
  assert.match(workflow, /apply-isolated-baseline\.mjs/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-self-workforce-http\.mjs/);
  assert.match(runner, /requireDisposableSelfWorkforce\(\)/);
  assert.match(runner, /seed\("ATTA"\)/);
  assert.match(runner, /seed\("ATTB"\)/);
  assert.match(runner, /seed\("VICTIM"\)/);
  assert.match(runner, /victimCoreBefore/);
  assert.doesNotMatch(runner, /https:\/\/(?!example\.invalid)/);
});

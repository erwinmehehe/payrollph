import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canReviewRosterBatch,
  parseRecordedBatchEmployeeIds,
  parseRosterBatchProposal,
  rosterBatchRequestSha,
  rosterBulkPublishEnabled,
  rosterBulkPilotOrganizationAllowed,
  safeSha256,
} from "../src/lib/workforce-bulk-publish";

const standard = {
  organizationId: 18, workDate: "2026-10-15", shiftDefinitionId: 7,
  employeeIds: [31, 12], reason: "Cover planned customer shift",
  idempotencyKey: "7d6aa276-e1ad-4c21-b249-557c95a11adc",
  acknowledged: true,
};

test("batch parse uses unique tenant-bound IDs, future work date and explicit acknowledgement", () => {
  const value = parseRosterBatchProposal(standard, "2026-10-10");
  assert.deepEqual(value.employeeIds, [12, 31]);
  assert.equal(value.organizationId, 18);
  assert.throws(() => parseRosterBatchProposal({ ...standard, acknowledged: false }, "2026-10-10"), /acknowledgement/);
  assert.throws(() => parseRosterBatchProposal({ ...standard, employeeIds: [12, 12] }, "2026-10-10"), /unique/);
  assert.throws(() => parseRosterBatchProposal({ ...standard, employeeIds: Array.from({length:21},(_,i)=>i+1) }, "2026-10-10"), /20/);
  assert.throws(() => parseRosterBatchProposal({ ...standard, workDate: "2026-10-10" }, "2026-10-10"), /future/);
  assert.throws(() => parseRosterBatchProposal({ ...standard, workDate: "2026-11-30" }, "2026-10-10"), /35/);
  assert.throws(() => parseRosterBatchProposal({ ...standard, workDate: "2026-10-32" }, "2026-10-10"), /valid calendar/);
  assert.throws(() => parseRosterBatchProposal({ ...standard, reason: " " }, "2026-10-10"), /reason/);
  assert.throws(() => parseRosterBatchProposal({ ...standard, idempotencyKey: "x" }, "2026-10-10"), /key/);
});

test("request digest is order-independent, deterministic and request-specific", () => {
  const a = parseRosterBatchProposal(standard, "2026-10-10");
  const b = parseRosterBatchProposal({ ...standard, employeeIds: [12, 31] }, "2026-10-10");
  assert.equal(rosterBatchRequestSha(a), rosterBatchRequestSha(b));
  assert.notEqual(rosterBatchRequestSha(a), rosterBatchRequestSha({ ...a, organizationId: 19 }));
  assert.match(safeSha256({a:1}), /^[a-f0-9]{64}$/);
});

test("stored IDs must be valid, bounded and distinct; makers cannot decide own batches", () => {
  assert.deepEqual(parseRecordedBatchEmployeeIds([7, 2]), [2, 7]);
  assert.throws(() => parseRecordedBatchEmployeeIds(["7"]));
  assert.throws(() => parseRecordedBatchEmployeeIds([7, 7]));
  assert.throws(() => parseRecordedBatchEmployeeIds([]));
  assert.equal(canReviewRosterBatch(7, 8), true);
  assert.equal(canReviewRosterBatch(7, 7), false);
  assert.equal(canReviewRosterBatch(0, 8), false);
});

test("bulk route defaults OFF and enforces company-wide, MFA, same-origin, atomic writer", () => {
  const s = readFileSync("src/app/api/workforce/roster-batches/route.ts", "utf8");
  const helper = readFileSync("src/lib/workforce-bulk-publish.ts", "utf8");
  assert.ok(helper.includes('process.env.WFM_BULK_ROSTER_PUBLISH_ENABLED === "true"'));
  assert.ok(s.includes("if (!rosterBulkPublishEnabled())"));
  assert.ok(s.includes("enforceSameOriginMutation(request)"));
  assert.ok(s.includes("assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES"));
  assert.ok(s.includes("!access?.companyWide"));
  assert.ok(s.includes("requireSensitiveActionMfa(user)"));
  assert.ok(s.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(s.includes('db.transaction(async tx => {'));
  assert.ok(s.includes('pg_advisory_xact_lock(6107'));
  assert.ok(s.includes('isolationLevel: "read committed"'));
  assert.ok(s.includes('canReviewRosterBatch(batch.requestedByUserId, user.id)'));
  assert.ok(s.includes('tx.insert(scheduleOverrides).values('));
  assert.ok(s.includes('tx.insert(auditEvents).values('));
  assert.ok(s.includes('checked.sha !== batch.evidenceSha256'));
  for (const source of [
    "leaveRequests", "timePunches", "overtimeRequests", "workforceTimesheets",
    "payrollRuns", "workforceAttendancePeriodLocks", "separationRecords",
    "evaluateHcmWorkPeriod", "evaluateSiteEligibility", "evaluateScheduleGuardrails",
    "resolveDailySchedule", "worksiteAssignments",
  ]) assert.ok(s.includes(source), source);
  assert.ok(!s.includes('await recordAuditEvent('));
  assert.ok(!s.includes('db.insert(scheduleOverrides)'));
});

test("schema has restricted immutable batch record and no ungoverned automatic publish", () => {
  const sql = readFileSync("drizzle/0107_governed_wfm_roster_batches.sql", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.match(sql, /requested_by_user_id/);
  assert.match(sql, /decided_by_user_id/);
  assert.match(sql, /wfm_roster_batches_maker_checker_check/);
  assert.match(sql, /wfm_roster_batches_idempotency_unique/);
  assert.match(sql, /wfm_roster_batches_decision_check/);
  assert.match(schema, /export const workforceRosterBatches = pgTable/);
});

test("staging and checking are only exposed behind UI gate; no automatic bank/payroll writes", () => {
  const p = readFileSync("src/components/workspace/workforce-bulk-roster-preview.tsx", "utf8");
  const reviews = readFileSync("src/components/workspace/workforce-roster-batch-reviews.tsx", "utf8");
  const workspace = readFileSync("src/components/workspace/workforce-planner.tsx", "utf8");
  assert.ok(p.includes('process.env.NEXT_PUBLIC_WFM_BULK_PUBLISH_UI_ENABLED === "true"'));
  assert.ok(workspace.includes('process.env.NEXT_PUBLIC_WFM_BULK_PUBLISH_UI_ENABLED === "true"'));
  assert.ok(p.includes('action: "stage"'));
  assert.ok(reviews.includes('"approve" | "reject"'));
  assert.ok(reviews.includes('currentUserId === chosen.requestedByUserId'));
  assert.ok(reviews.includes('snapshot?.employer === organizationId'));
  assert.ok(!p.includes('/api/payroll'));
  assert.ok(!reviews.includes('/api/payout'));
});

test("bulk pilot tenant gate rejects missing, malformed and broad configuration", () => {
  const permitted = (org: number, allowlist?: string) =>
    rosterBulkPilotOrganizationAllowed(org, allowlist);
  assert.equal(permitted(17, ""), false);
  assert.equal(permitted(17, "*"), false);
  assert.equal(permitted(17, "17"), true);
  assert.equal(permitted(18, "17"), false);
  assert.equal(permitted(18, "17, 18, 29"), true);
  assert.equal(permitted(18, "17, 18, *"), false);
  assert.equal(permitted(18, "18, 18"), false);
  assert.equal(permitted(18, "18, -19"), false);
  assert.equal(permitted(18, "18, +19"), false);
  assert.equal(permitted(18, "18, 0"), false);
  assert.equal(permitted(18, "18, 2147483648"), false);
  assert.equal(permitted(18, "18,"), false);
  assert.equal(permitted(18, "18,not-an-id"), false);
  assert.equal(permitted(18, Array.from({ length: 21 }, (_, i) => String(i + 1)).join(",")), false);
  assert.equal(permitted(2147483648, "2147483648"), false);
});

test("both API methods enforce server-side pilot allowlist before tenant data access", () => {
  const api = readFileSync("src/app/api/workforce/roster-batches/route.ts", "utf8");
  assert.equal((api.match(/if \(!rosterBulkPilotOrganizationAllowed\(organizationId\)\)/g) ?? []).length, 2);
  assert.ok(api.includes('Governed roster batches are not enabled for this organization.'));
  assert.ok(!api.includes("NEXT_PUBLIC_WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS"));
});

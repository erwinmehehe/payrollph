import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/remittance-month-close/route.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const panel = readFileSync("src/components/workspace/statutory-remittance-month-close.tsx", "utf8");
const payroll = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");

test("month close persists a unique evidence certification per organization and month", () => {
  assert.ok(schema.includes('export const statutoryRemittanceMonthClosures = pgTable('));
  assert.ok(schema.includes('uniqueIndex("statutory_remittance_month_closure_snapshot_unique")'));
  assert.ok(schema.includes('snapshotHash: varchar("snapshot_hash"'));
});

test("certification is restricted to prior months and current reconciled evidence", () => {
  assert.ok(route.includes("applicableMonth >= currentManilaMonth()"));
  assert.ok(route.includes("current.evaluation.ready"));
  assert.ok(route.includes("This remittance month is not ready to certify."));
  assert.ok(route.includes("current.evaluation.snapshotHash"));
});

test("certification uses payroll RBAC, MFA, rate limits, same-origin and audit trail", () => {
  assert.ok(route.includes('const REMITTANCE_CLOSE_ROLES = ["owner", "admin", "checker"]'));
  assert.ok(route.includes("enforceSameOriginMutation(request)"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes("recordAuditEvent"));
});

test("existing certification is valid only while the live evidence hash still matches", () => {
  assert.ok(route.includes("closure.snapshotHash === evaluation.snapshotHash"));
  assert.ok(route.includes("&& evaluation.ready"));
});

test("payroll UI clearly separates month certification from remittance reconciliation", () => {
  assert.ok(panel.includes("REMITTANCE MONTH CLOSE"));
  assert.ok(panel.includes("Previous certification is no longer current."));
  assert.ok(panel.includes("the live remittance evidence now has a different snapshot"));
  assert.ok(panel.includes("Cannot certify."));
  assert.ok(payroll.includes("<StatutoryRemittanceMonthClose"));
});


test("month close derives required agencies from the selected month's payroll liability", () => {
  assert.ok(route.includes("statutoryLiabilityKeys"));
  assert.ok(route.includes("requiredAgencies"));
  assert.ok(route.includes('monthRuns.every((run) => run.status === "Released")'));
  assert.ok(route.includes("payrollEntries"));
});


test("certifier cannot certify evidence they helped create, upload, or correct", () => {
  assert.ok(route.includes("evidenceActorIdentity"));
  assert.ok(route.includes("buildEvidenceActorIdentity"));
  assert.ok(route.includes("certifierConflictsWithEvidence"));
  assert.ok(route.includes("paymentRecordedByUserId"));
  assert.ok(route.includes("confirmedByUserId"));
  assert.ok(route.includes("decidedByUserId"));
  assert.ok(route.includes("uploadedByUserId"));
  assert.ok(route.includes("cannot certify a remittance month containing evidence they recorded, uploaded, confirmed, corrected, or resolved"));
});

test("certification history is immutable per evidence snapshot", () => {
  assert.ok(route.includes("existingSnapshot"));
  assert.ok(route.includes("certificationHistory: closures"));
  assert.ok(route.includes("certificationHistoryPreserved: true"));
  assert.ok(!route.includes("db.update(statutoryRemittanceMonthClosures).set({"));
});

test("month close self-initializes additive schema for existing deployments", () => {
  const guard = readFileSync("src/lib/statutory-remittance-month-close-schema.ts", "utf8");
  assert.ok(route.includes("ensureStatutoryRemittanceMonthCloseSchema"));
  assert.ok(guard.includes("CREATE TABLE IF NOT EXISTS statutory_remittance_month_closures"));
  assert.ok(guard.includes("statutory_remittance_month_closure_snapshot_unique"));
  assert.ok(guard.includes("pg_advisory_xact_lock"));
  assert.ok(guard.includes("ensureStatutoryRemittanceCorrectionSchema"));
});


test("month close includes employee contribution case history and unresolved blockers", () => {
  assert.ok(route.includes("statutoryContributionIssueCases"));
  assert.ok(route.includes("issueCases"));
  assert.ok(route.includes("issueCases.map((issue)"));
  assert.ok(route.includes("userId: issue.resolvedByUserId"));
  assert.ok(route.includes("name: issue.resolvedByName"));
  assert.ok(route.includes("recorded, uploaded, confirmed, corrected, or resolved"));
});

test("certification snapshot invalidation helper preserves history instead of deleting closures", () => {
  const helper = readFileSync("src/lib/statutory-remittance-certification.ts", "utf8");
  assert.ok(helper.includes('status: "invalidated"'));
  assert.ok(helper.includes("invalidatedAt"));
  assert.ok(helper.includes("invalidationReason"));
  assert.ok(!helper.includes("delete("));
});

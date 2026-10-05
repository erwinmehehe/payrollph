import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/remittance-month-close/route.ts", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const panel = readFileSync("src/components/workspace/statutory-remittance-month-close.tsx", "utf8");
const payroll = readFileSync("src/components/workspace/payroll-run.tsx", "utf8");

test("month close persists a unique evidence certification per organization and month", () => {
  assert.ok(schema.includes('export const statutoryRemittanceMonthClosures = pgTable('));
  assert.ok(schema.includes('uniqueIndex("statutory_remittance_month_closure_unique")'));
  assert.ok(schema.includes('snapshotHash: varchar("snapshot_hash"'));
});

test("certification is restricted to prior months and current reconciled evidence", () => {
  assert.ok(route.includes("applicableMonth >= currentManilaMonth()"));
  assert.ok(route.includes("current.evaluation.ready"));
  assert.ok(route.includes("This remittance month is not ready to certify."));
  assert.ok(route.includes("current.evaluation.snapshotHash"));
});

test("certification uses payroll RBAC, MFA, rate limits, same-origin and audit trail", () => {
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
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
  assert.ok(panel.includes("Previous certification is no longer valid."));
  assert.ok(panel.includes("Cannot certify."));
  assert.ok(payroll.includes("<StatutoryRemittanceMonthClose"));
});

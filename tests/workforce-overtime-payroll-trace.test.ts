import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/lib/payroll-engine.ts", "utf8");

test("payroll loads overtime requests within tenant, employee and cutoff scope", () => {
  assert.ok(source.includes("eq(overtimeRequests.organizationId, input.organizationId)"));
  assert.ok(source.includes("inArray(overtimeRequests.employeeId, chunkIds)"));
  assert.ok(source.includes("gte(overtimeRequests.workDate, run.periodStart)"));
  assert.ok(source.includes("lte(overtimeRequests.workDate, run.periodEnd)"));
});

test("actual overtime is accumulated by work date before authorization evidence is resolved", () => {
  assert.ok(source.includes("overtimeMinutesByWorkDate.set("));
  assert.ok(source.includes("resolveOvertimeAuthorizationDay({"));
  assert.ok(source.includes("actualOvertimeMinutes: overtimeMinutesByWorkDate.get(workDate) ?? 0"));
});

test("authorization failures become payroll review exceptions without suppressing statutory OT pay", () => {
  assert.ok(source.includes("Statutory overtime pay remains based on validated attendance"));
  assert.ok(source.includes('evidence.reviewReason === "missing_request"'));
  assert.ok(source.includes('evidence.reviewReason === "multiple_requests"'));
  assert.ok(source.includes('evidence.reviewReason === "not_approved"'));
  assert.ok(source.includes('evidence.reviewReason === "exceeds_approved_minutes"'));

  const segmentedPayFormula = source.indexOf(
    "overtimePay += hours * punchProfile.hourlyRate * multiplier",
  );
  const fallbackPayFormula = source.indexOf(
    "(segmentedOvertimeMinutes / 60) * punchProfile.hourlyRate * otMultiplier",
  );
  const authorization = source.indexOf("resolveOvertimeAuthorizationDay({");
  assert.ok(segmentedPayFormula >= 0);
  assert.ok(fallbackPayFormula >= 0);
  assert.ok(
    authorization > segmentedPayFormula && authorization > fallbackPayFormula,
    "authorization evidence must be evaluated after statutory OT pay is calculated",
  );
});

test("payroll trace persists OT authorization evidence and its independence from wage entitlement", () => {
  assert.ok(source.includes("overtimeAuthorization: {"));
  assert.ok(source.includes("payrollEntitlementIndependent: true"));
  assert.ok(source.includes("overtimeAuthorizationReviewDays="));
  assert.ok(source.includes("overtimeAuthorizedMinutes="));
  assert.ok(source.includes("overtimeAuthorizationRequests="));
});

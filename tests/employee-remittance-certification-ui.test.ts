import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const closeRoute = readFileSync("src/app/api/compliance/remittance-month-close/route.ts", "utf8");
const closeState = readFileSync("src/lib/statutory-remittance-close-state.ts", "utf8");
const selfApi = readFileSync("src/app/api/self/payslips/route.ts", "utf8");
const portal = readFileSync("src/components/self-service-portal.tsx", "utf8");

test("payroll close API and employee status use the same close-state loader", () => {
  assert.ok(closeRoute.includes("loadStatutoryRemittanceMonthCloseState"));
  assert.ok(selfApi.includes("loadStatutoryRemittanceMonthCloseState"));
  assert.ok(closeState.includes("evaluateRemittanceMonthClose"));
  assert.ok(closeState.includes("closure.snapshotHash === evaluation.snapshotHash"));
  assert.ok(closeState.includes("&& evaluation.ready"));
});

test("employee self-service reuses one remittance state for recent contribution months", () => {
  assert.ok(selfApi.includes("loadStatutoryRemittanceState(employee.organizationId)"));
  assert.ok(selfApi.includes("contributionMonths"));
  assert.ok(selfApi.includes("slice(0, 12)"));
  assert.ok(selfApi.includes("remittanceState,"));
  assert.ok(selfApi.includes("certificationByMonth"));
});

test("employee API exposes safe certification status without reviewer identity", () => {
  assert.ok(selfApi.includes("certification: certificationByMonth.get"));
  assert.ok(selfApi.includes('status: "not_certified"'));
  assert.ok(!selfApi.includes("certifiedByName:"));
  assert.ok(!selfApi.includes("certifiedByUserId:"));
});

test("employee UI separates member posting confirmation from full-month certification", () => {
  assert.ok(portal.includes("Independent month review"));
  assert.ok(portal.includes("row.certification.label"));
  assert.ok(portal.includes("Agency posting confirmed"));
  assert.ok(portal.includes("full month’s statutory evidence also passed independent review"));
});

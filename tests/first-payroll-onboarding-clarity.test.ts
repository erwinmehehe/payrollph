import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFirstPayrollReadiness } from "../src/lib/first-payroll-readiness";

test("first payroll readiness never equates setup with release or independent certification", () => {
  const setup = buildFirstPayrollReadiness({
    workspaceName: "Demo Employer",
    employees: [{ status: "Active", bankAccount: "synthetic-123", bankCode: "TEST" }],
    memberships: [{ role: "payroll" }, { role: "checker" }],
    payrollStatuses: [],
  });
  assert.equal(setup.ready, true);
  assert.equal(setup.firstPayrollStarted, false);
  assert.equal(setup.firstPayrollReleased, false);

  const ui = readFileSync("src/components/workspace/first-payroll-readiness.tsx", "utf8");
  assert.ok(ui.includes("Workspace setup complete."));
  assert.ok(ui.includes("calculation, statutory and independent checker approval"));
  assert.ok(ui.includes("requires signed real-employer reconciliation evidence"));
  assert.ok(ui.includes("A completed setup checklist does not certify payroll or authorize payment."));
  assert.ok(!ui.includes("Ready for first payroll."));
});

import assert from "node:assert/strict";
import test from "node:test";
import { assertPayrollPayslipTenantOwnership } from "../src/lib/payroll-export-tenant-ownership";

const own = 101, victim = 202;
const denial = "Payroll export unavailable: employee ownership could not be verified.";
const row = (slipOrg = own, slipWorker = 11, entryWorker = 11, workerOrg = own) => ({
  slip: { organizationId: slipOrg, employeeId: slipWorker },
  entryEmployeeId: entryWorker,
  employee: { organizationId: workerOrg },
});

test("owned matching payslips and a genuinely empty employer export are allowed", () => {
  assert.doesNotThrow(() => assertPayrollPayslipTenantOwnership(own, [row(), row(own, 12, 12)]));
  assert.doesNotThrow(() => assertPayrollPayslipTenantOwnership(own, []));
});

test("a foreign worker, mismatch, forged slip employer or orphan blocks the entire export", () => {
  const invalidRows = [
    row(own, 11, 11, victim),
    row(own, 55, 11, own),
    row(victim, 11, 11, own),
    { ...row(), employee: null },
    row(own, 0, 0, own),
  ];
  for (const invalid of invalidRows) {
    assert.throws(() => assertPayrollPayslipTenantOwnership(own, [row(), invalid, row()]), {
      message: denial,
    });
  }
});

test("an invalid association prevents serialization with no victim ID in the error", () => {
  let serialized = false;
  function exportRows() {
    const rows = [row(), row(own, 22, 22, victim)];
    assertPayrollPayslipTenantOwnership(own, rows);
    serialized = true;
    return rows;
  }
  assert.throws(exportRows, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, denial);
    assert.ok(!error.message.includes(String(victim)));
    return true;
  });
  assert.equal(serialized, false);
});

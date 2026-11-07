import assert from "node:assert/strict";
import test from "node:test";
import { assertPayrollExportTenantOwnership } from "../src/lib/payroll-export-tenant-ownership";

const employerA = 401;
const employerB = 802;
const row = (organizationId: number) => ({
  employee: { organizationId },
});
const denial = "Payroll export unavailable: employee ownership could not be verified.";

test("legitimate export rows and an empty employer register stay permitted", () => {
  assert.doesNotThrow(() => assertPayrollExportTenantOwnership(employerA, [
    row(employerA), row(employerA),
  ]));
  assert.doesNotThrow(() => assertPayrollExportTenantOwnership(employerB, [
    row(employerB),
  ]));
  assert.doesNotThrow(() => assertPayrollExportTenantOwnership(employerA, []));
});

test("foreign worker at any position denies the entire employer export", () => {
  for (const rows of [
    [row(employerB), row(employerA)],
    [row(employerA), row(employerB), row(employerA)],
    [row(employerA), row(employerB)],
  ]) {
    assert.throws(
      () => assertPayrollExportTenantOwnership(employerA, rows),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, denial);
        assert.ok(!error.message.includes(String(employerA)));
        assert.ok(!error.message.includes(String(employerB)));
        return true;
      },
    );
  }
  assert.throws(() => assertPayrollExportTenantOwnership(employerB, [
    row(employerA),
  ]), { message: denial });
});

test("missing worker or malformed employer identity fails closed", () => {
  for (const rows of [
    [{ employee: null }],
    [row(0)],
    [row(-1)],
  ]) {
    assert.throws(
      () => assertPayrollExportTenantOwnership(employerA, rows),
      { message: denial },
    );
  }
  for (const organizationId of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => assertPayrollExportTenantOwnership(organizationId, [row(employerA)]),
      { message: denial },
    );
  }
});

test("cross-employer record aborts before serialization rather than omitting it", () => {
  let serialized = false;
  function serialize(rows: Array<ReturnType<typeof row>>) {
    assertPayrollExportTenantOwnership(employerA, rows);
    serialized = true;
    return rows.map((value) => value.employee.organizationId);
  }
  assert.throws(() => serialize([row(employerA), row(employerB)]), { message: denial });
  assert.equal(serialized, false, "no partial foreign-worker export");
});

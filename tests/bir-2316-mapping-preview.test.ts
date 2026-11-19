import assert from "node:assert/strict";
import test from "node:test";
import { buildBir2316MappingPreview } from "../src/lib/bir-2316-mapping-preview";

const scope = { organizationId: 1, employeeId: 2, legalEntityId: 3, taxYear: 2026 };
const summary = {
  grossCompensation: "31100.00", nonTaxable: "1100.00", taxableIncome: "30000.00",
  taxDue: "0.00", withheldBeforeYearEnd: "0.00", yearEndAdjustment: "0.00", mwe: false, unpaidThirteenth: "0.00",
};
const allowance = {
  code: "EARN-3", label: "Fictional allowance", amount: "1100.00",
  notes: ["Type: recurring_allowance", "Tax treatment: non-taxable"],
};
const leave = {
  code: "LEAVE_CONV-5", label: "Leave Conversion (vacation 2d)", amount: "1500.00",
  notes: ["2 days @ daily rate ₱750", "Tax treatment: exempt"],
};
const basic = { code: "BASIC", label: "Basic pay", amount: "30000.00" };
function released(id: number, payDate: string, mwe: boolean, lineItems: unknown[]) {
  return {
    ...scope, id, runId: id + 100, payDate, periodStart: payDate, periodEnd: payDate, grossPay: "31100.00", status: "Released", lineItems,
    trace: { inputs: [`mwe=${mwe}`, "mweClassificationSource=explicit", "mweClassificationRegion=NCR",
      "mweWageOrderReference=Fictional wage order", "mweEmployeeDailyWage=700", "mweStatutoryMinimumWage=700"] },
  };
}

test("released allowance evidence and candidate reconcile without zero-filling or populating certificate inputs", () => {
  const records = [released(1, "2026-01-15", false, [basic, allowance]),
    { ...released(2, "2026-01-31", true, [leave]), status: "Approved" }];
  const preview = buildBir2316MappingPreview(scope, records, [], summary);
  assert.equal(preview.totalsMatch, true);
  assert.deepEqual(preview.proposed.map(({ item, amount }) => [item, amount]), [["37", "1100.00"], ["39", "30000.00"]]);
  assert.deepEqual(preview.allowances.map(({ entryId, lineNumber, amount, treatment }) => [entryId, lineNumber, amount, treatment]),
    [[1, 2, "1100.00", "non-taxable"]]);
  assert.equal(preview.leaveConversions.length, 0);
  assert.equal(preview.periods.length, 1);
  assert.match(preview.issues.join(), /verify the exemption basis/);
  const mismatch = buildBir2316MappingPreview(scope, records, [], { ...summary, nonTaxable: "1100.01", taxableIncome: "29999.99" });
  assert.equal(mismatch.totalsMatch, false);
});

test("mixed MWE periods, released leave and imported rows preserve recorded evidence and hold the annual proposal", () => {
  const rows = [
    released(2, "2026-08-31", false, [basic, allowance]),
    released(1, "2026-08-15", true, [basic, leave]),
  ];
  const imports = [{ id: 11, payDate: "2026-02-28", grossPay: "25000.00", basicSalary: null }];
  const preview = buildBir2316MappingPreview(scope, rows, imports, summary);
  assert.deepEqual(preview.periods.map(({ mwe, wageOrder, payDate }) => [mwe, wageOrder, payDate]), [
    [true, "Fictional wage order", "2026-08-15"], [false, "Fictional wage order", "2026-08-31"],
  ]);
  assert.deepEqual(preview.imported, imports);
  assert.deepEqual(preview.leaveConversions.map(({ detail, treatment, amount }) => [detail, treatment, amount]),
    [["2 days @ daily rate ₱750", "exempt", "1500.00"]]);
  assert.equal(preview.totalsMatch, null);
  assert.deepEqual(preview.proposed, []);
  assert.match(preview.issues.join(), /mixed minimum-wage status/);
  assert.match(preview.issues.join(), /verify the leave type/);
  assert.match(preview.issues.join(), /summary amounts only/);
});

test("a record with unverified legal-employer attribution returns no payroll evidence", () => {
  const preview = buildBir2316MappingPreview(scope,
    [{ ...released(1, "2026-01-15", false, [basic, allowance]), legalEntityId: null }], [], summary);
  assert.deepEqual(preview.periods, []);
  assert.deepEqual(preview.allowances, []);
  assert.deepEqual(preview.proposed, []);
  assert.match(preview.issues.join(), /attribution/);
});

test("legacy periods with unrecorded MWE status and malformed line amounts are held", () => {
  const preview = buildBir2316MappingPreview(scope,
    [{ ...released(1, "2026-01-15", false, [basic, { ...allowance, amount: "" }]), trace: {} }], [], summary);
  assert.equal(preview.periods[0].mwe, null);
  assert.deepEqual(preview.proposed, []);
  assert.match(preview.issues.join(), /missing or ambiguous/);
  assert.match(preview.issues.join(), /missing usable payroll lines/);
});

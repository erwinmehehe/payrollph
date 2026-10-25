import assert from "node:assert/strict";
import test from "node:test";
import { loadApprovedPayrollExits, verifiedExitPayrollTrace } from "../src/lib/approved-exit-payroll";
import { computeFinalPay, readBasicAndThirteenth } from "../src/lib/final-pay";

// Pure boundary tests: no database, release, provider, or policy activation.
const approved = { id: 42, employeeId: 7, lastDay: "2026-10-09", unpaidBasicSalary: "0.00",
  preparedByUserId: 10, approvedByUserId: 11 };
function reader(rows: unknown[]) {
  return { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }) } as unknown as Parameters<typeof loadApprovedPayrollExits>[0];
}

test("final-pay first: ordinary wages refuse an already approved unpaid-basic claim", async () => {
  const saved = process.env.APPROVED_EXIT_PAYROLL_ENABLED;
  try {
    process.env.APPROVED_EXIT_PAYROLL_ENABLED = "true";
    for (const amount of ["6600.00", "0.01", "-0.01", "invalid"]) {
      await assert.rejects(loadApprovedPayrollExits(reader([{ ...approved, unpaidBasicSalary: amount }]),
        1, [{ id: 7, status: "Separating" }]), /PAYROLL_FINAL_PAY_WAGE_OVERLAP/);
    }
    const result = await loadApprovedPayrollExits(reader([approved]), 1, [{ id: 7, status: "Separating" }]);
    assert.equal(result.ends.get(7), "2026-10-09");
    assert.equal(result.ids.get(7), 42);
    await assert.rejects(loadApprovedPayrollExits(reader([]), 1, [{ id: 7, status: "Separating" }]),
      /PAYROLL_EXIT_APPROVAL_REQUIRED/);
    for (const checker of [null, 10]) {
      await assert.rejects(loadApprovedPayrollExits(reader([{ ...approved, approvedByUserId: checker }]),
        1, [{ id: 7, status: "Separating" }]), /PAYROLL_EXIT_APPROVAL_IDENTITY/);
    }
    await assert.rejects(loadApprovedPayrollExits(reader([approved, { ...approved, id: 43, lastDay: "2026-10-10" }]),
      1, [{ id: 7, status: "Separating" }]), /PAYROLL_SEPARATION_CONFLICT/);
  } finally {
    if (saved === undefined) delete process.env.APPROVED_EXIT_PAYROLL_ENABLED;
    else process.env.APPROVED_EXIT_PAYROLL_ENABLED = saved;
  }
});

test("ordinary first: capped BASIC enters annual base once, with signed same-year retro attribution", () => {
  const trace = { inputs: ["approvedExitProration=v1", "employmentEnd=2026-10-09", "approvedSeparationId=42"] };
  assert.equal(verifiedExitPayrollTrace(trace, approved.lastDay, approved.id), true);
  const lines = [{ code: "BASIC", amount: "6600.00" }, { code: "RETRO-8", amount: "120.00" },
    { code: "RETRO-9", amount: "-24.00" }, { code: "RETRO-10", amount: "500.00" }];
  const base = readBasicAndThirteenth(lines, { taxYear: 2026,
    sourceYearByAdjustmentId: new Map([[8, 2026], [9, 2026], [10, 2025]]) });
  assert.equal(base.basic, 6696, "prior-year retro must not inflate this year's BASIC");
  const input = { releasedBasicYtd: base.basic, historicalBasicYtd: 0, unpaidBasicSalary: 0,
    thirteenthPaidYtd: 0, grossCompensationYtd: 7196, statutoryContributionsYtd: 0,
    taxWithheldYtd: 0, mwe: true, leaveMonetizationPay: 0, separationPay: 0,
    retirementPay: 0, otherBenefits: 0, loanDeductions: 0 };
  const first = computeFinalPay(input);
  assert.equal(first.basicSalaryEarnedYtd, 6696);
  assert.equal(first.thirteenthEntitlement, 558);
  assert.equal(first.grossFinalPay, 558, "released BASIC is not paid again as unpaid wages");
  assert.deepEqual(computeFinalPay(input), first, "recomputing is not another liability");
  assert.equal(computeFinalPay({ ...input, thirteenthPaidYtd: 558 }).thirteenthDue, 0);
  assert.throws(() => readBasicAndThirteenth(lines, { taxYear: 2026, sourceYearByAdjustmentId: new Map() }),
    /FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED/);
  assert.equal(verifiedExitPayrollTrace(trace, approved.lastDay, 43), false);
  assert.equal(verifiedExitPayrollTrace({ inputs: [...trace.inputs, "employmentEnd=2026-10-15"] }, approved.lastDay, 42), false);
});

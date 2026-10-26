import assert from "node:assert/strict";
import test from "node:test";
import { summarizeHcmPeopleIntelligence } from "../src/lib/hcm-people-intelligence";

type Input = Parameters<typeof summarizeHcmPeopleIntelligence>[0];
const base: Input = {
  asOf: "2026-10-26", today: "2026-10-26", windowDays: 30,
  workers: [], events: [], positions: [], assignments: [], requisitions: [], applicants: [],
  separations: [], payrollRuns: [], cycles: [], proposals: [], units: [],
};
const payroll = (grossPay: string, netPay = "80.25") => ({
  status: "Released", payDate: base.asOf, grossPay, netPay,
});
const position = (id: number, annualBudget: string) => ({ id, annualBudget, status: "open", orgUnitId: null });
const cycle = (id: number, budgetPool: string) => ({ id, budgetPool, status: "active" });
const proposal = (currentAnnual: string, proposedAnnual: string) => ({
  cycleId: 1, status: "approved", currentAnnual, proposedAnnual,
});

test("missing or coercible source amounts never become verified zero in any financial metric", () => {
  for (const bad of ["", " ", "\t", "0x10", "1e3", "Infinity", "NaN", "-1", null, undefined] as unknown as string[]) {
    const report = summarizeHcmPeopleIntelligence({ ...base,
      payrollRuns: [payroll(bad)], positions: [position(1, bad)],
      cycles: [cycle(1, bad)], proposals: [proposal(bad, "120.00")],
    });
    assert.equal(report.releasedPayrollGross, null, String(bad));
    assert.equal(report.releasedPayrollNet, 80.25);
    assert.equal(report.recordedAnnualVacancyBudget, null);
    assert.equal(report.activeCycleBudget, null);
    assert.equal(report.approvedCompensationDeltaAnnual, null);
    for (const word of ["payroll", "Vacancy", "cycle", "Approved compensation"]) {
      assert.ok(report.warnings.some(warning => warning.includes(word)), word);
    }
    const proposedMissing = summarizeHcmPeopleIntelligence({ ...base, cycles: [cycle(1, "0")], proposals: [proposal("100", bad)] });
    assert.equal(proposedMissing.approvedCompensationDeltaAnnual, null);
  }
});

test("unsafe individual and aggregate amounts are withheld, including cancelling compensation sides", () => {
  const amounts = [["90071992547410.00"], ["50000000000000.00", "50000000000000.00"]];
  for (const values of amounts) {
    const report = summarizeHcmPeopleIntelligence({ ...base,
      payrollRuns: values.map(value => payroll(value, value)),
      positions: values.map((value, index) => position(index + 1, value)),
      cycles: values.map((value, index) => cycle(index + 1, value)),
      proposals: values.map(value => proposal(value, value)),
    });
    for (const key of ["releasedPayrollGross", "releasedPayrollNet", "recordedAnnualVacancyBudget", "activeCycleBudget", "approvedCompensationDeltaAnnual"] as const) {
      assert.equal(report[key], null, key);
    }
    assert.ok(report.warnings.some(warning => warning.includes("safe reporting range")));
  }
});

test("verified empty and explicit zero remain zero; valid decreases and decimal totals remain usable", () => {
  const empty = summarizeHcmPeopleIntelligence(base);
  for (const key of ["releasedPayrollGross", "releasedPayrollNet", "recordedAnnualVacancyBudget", "activeCycleBudget", "approvedCompensationDeltaAnnual"] as const) assert.equal(empty[key], 0);
  const report = summarizeHcmPeopleIntelligence({ ...base,
    payrollRuns: [payroll("100.10", "0.00"), payroll("20.25", "0")],
    positions: [position(1, "0.00"), position(2, "50.25")],
    cycles: [cycle(1, "200.10"), cycle(2, "300.25")],
    proposals: [proposal("100.50", "90.25")],
  });
  assert.equal(report.releasedPayrollGross, 120.35);
  assert.equal(report.releasedPayrollNet, 0);
  assert.equal(report.recordedAnnualVacancyBudget, 50.25);
  assert.equal(report.activeCycleBudget, 500.35);
  assert.equal(report.approvedCompensationDeltaAnnual, -10.25);
});

test("out-of-scope records do not poison verified totals and historical current-state metrics stay unavailable", () => {
  const report = summarizeHcmPeopleIntelligence({ ...base,
    payrollRuns: [payroll("100"), { ...payroll(""), status: "Draft" }, { ...payroll(""), payDate: "2025-01-01" }],
    cycles: [cycle(1, "100"), { ...cycle(2, ""), status: "closed" }],
    proposals: [proposal("10", "20"), { ...proposal("", ""), status: "proposed" }, { ...proposal("", ""), cycleId: 2 }],
    positions: [position(1, "50"), { ...position(2, ""), status: "planned" }],
  });
  assert.equal(report.releasedPayrollGross, 100);
  assert.equal(report.activeCycleBudget, 100);
  assert.equal(report.approvedCompensationDeltaAnnual, 10);
  assert.equal(report.recordedAnnualVacancyBudget, 50);
  const historical = summarizeHcmPeopleIntelligence({ ...base, asOf: "2026-10-25" });
  assert.equal(historical.activeCycleBudget, null);
  assert.equal(historical.approvedCompensationDeltaAnnual, null);
  assert.equal(historical.recordedAnnualVacancyBudget, null);
});

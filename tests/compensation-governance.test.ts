import assert from "node:assert/strict";
import test from "node:test";
import { annualizePay, compaRatio, proposalBudgetDelta, proposalWithinBand, rateFromAnnual, validateBand } from "../src/lib/compensation";

test("compensation annualizes and reverses monthly daily and hourly pay", () => {
  assert.equal(annualizePay({ payBasis: "monthly", rateAmount: 50000, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 }), 600000);
  assert.equal(annualizePay({ payBasis: "daily", rateAmount: 1000, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 }), 264000);
  assert.equal(annualizePay({ payBasis: "hourly", rateAmount: 100, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 }), 211200);
  assert.equal(rateFromAnnual({ payBasis: "monthly", annualSalary: 600000, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 }), 50000);
});

test("salary bands and compa-ratio fail closed around invalid proposals", () => {
  assert.deepEqual(validateBand({ minimumAnnual: 400000, midpointAnnual: 500000, maximumAnnual: 700000 }), { ok: true });
  assert.equal(validateBand({ minimumAnnual: 500000, midpointAnnual: 400000, maximumAnnual: 700000 }).ok, false);
  assert.equal(compaRatio(550000, 500000), 110);
  assert.equal(proposalWithinBand(550000, 400000, 700000), true);
  assert.equal(proposalWithinBand(750000, 400000, 700000), false);
  assert.equal(proposalBudgetDelta(500000, 550000), 50000);
});

test("compensation API requires explicit approval before writing payroll", () => {
  const api = require("node:fs").readFileSync("src/app/api/compensation/route.ts", "utf8");
  assert.ok(api.includes('PAYROLL_RELEASE_ROLES'), "only release-authority roles may approve pay changes");
  assert.ok(api.includes('status: "proposed"'), "new proposals must remain pending");
  assert.ok(api.includes("employeePayRevisions"), "approval must create effective-dated payroll history");
  assert.ok(api.includes("db.transaction"), "pay revision and proposal approval must be atomic");
  assert.ok(api.includes("cycle.budgetPool"), "approval must enforce the review-cycle budget");
  assert.ok(!api.includes("performanceReviews"), "performance reviews must never auto-drive pay");
});

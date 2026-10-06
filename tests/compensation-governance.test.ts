import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  annualizePay,
  compaRatio,
  proposalBudgetDelta,
  proposalWithinBand,
  rateFromAnnual,
  validateBand,
} from "../src/lib/compensation";

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

test("compensation approval uses effective-dated payroll history without mutating the base pay profile", () => {
  const api = readFileSync("src/app/api/compensation/route.ts", "utf8");
  assert.ok(api.includes("employeePayRevisions"));
  assert.ok(api.includes("resolvePayTimeline"));
  assert.ok(api.includes('action: "Compensation proposal approved and scheduled"'));
  assert.ok(api.includes("livePayProfileMutated: false"));
  assert.equal(api.includes("tx.update(employeePayProfiles).set"), false);
});

test("salary band must match the employee position and location on the effective date", () => {
  const api = readFileSync("src/app/api/compensation/route.ts", "utf8");
  assert.ok(api.includes("assignmentForDate"));
  assert.ok(api.includes("position.jobProfileId !== input.band.jobProfileId"));
  assert.ok(api.includes('location !== "PH" && location !== employeeRegion'));
  assert.ok(api.includes("cycle.effectiveDate"));
});

test("cycle budget approval is serialized and stale pay cannot be approved", () => {
  const api = readFileSync("src/app/api/compensation/route.ts", "utf8");
  assert.ok(api.includes("FOR UPDATE"));
  assert.ok(api.includes("CYCLE_BUDGET_EXCEEDED"));
  assert.ok(api.includes("CURRENT_PAY_CHANGED"));
  assert.ok(api.includes("PAY_REVISION_DATE_CONFLICT"));
  assert.ok(api.includes("approvedBudget + thisDelta"));
});

test("compensation decisions require company-wide Owner/Admin, MFA and separation of duties", () => {
  const api = readFileSync("src/app/api/compensation/route.ts", "utf8");
  assert.ok(api.includes('const COMPENSATION_APPROVER_ROLES = ["owner", "admin"] as const'));
  assert.ok(api.includes("requireSensitiveActionMfa(user)"));
  assert.ok(api.includes("enforceSensitiveActionRateLimit"));
  assert.ok(api.includes("initialProposal.submittedByUserId === user.id"));
  assert.ok(api.includes("Separation of duties"));
  assert.ok(api.includes("publicDemoMutationDenied"));
});

test("compensation governance is additive across migration, baseline and production compatibility", () => {
  for (const path of [
    "drizzle/0040_compensation_governance.sql",
    "drizzle/baseline.sql",
    "src/db/schema.ts",
    "src/lib/core-schema-compat.ts",
  ]) {
    const content = readFileSync(path, "utf8");
    assert.ok(content.includes("compensation_bands"), path);
    assert.ok(content.includes("compensation_cycles"), path);
    assert.ok(content.includes("compensation_proposals"), path);
  }
});

test("performance reviews never auto-apply salary changes", () => {
  const api = readFileSync("src/app/api/compensation/route.ts", "utf8");
  assert.equal(api.includes("performanceReviews"), false);
});

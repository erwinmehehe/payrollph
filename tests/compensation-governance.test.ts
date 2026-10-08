import assert from "node:assert/strict";
import test from "node:test";
import { annualizePay, compaRatio, evaluateCompensationCycleBudget, proposalBudgetDelta, proposalWithinBand, rateFromAnnual, validateBand } from "../src/lib/compensation";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { organizations, payrollRuns } from "../src/db/schema";
import {
  compensationPayrollConflicts,
  invalidatePayrollRunsForCompensationChange,
} from "../src/lib/hcm-compensation";

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

test("two competing salary approvals cannot spend the same budget headroom", () => {
  const original = [
    { id: 1, status: "proposed", currentAnnual: "400000.00", proposedAnnual: "440000.00" },
    { id: 2, status: "proposed", currentAnnual: "400000.00", proposedAnnual: "440000.00" },
  ];
  const first = evaluateCompensationCycleBudget({
    budgetPool: 50000,
    candidateProposalId: 1,
    currentAnnual: 400000,
    proposedAnnual: 440000,
    existingProposals: original,
  });
  assert.equal(first.allowed, true);
  assert.equal(first.requestedIncrease, 40000);
  const second = evaluateCompensationCycleBudget({
    budgetPool: 50000,
    candidateProposalId: 2,
    currentAnnual: 400000,
    proposedAnnual: 440000,
    existingProposals: [{ ...original[0], status: "scheduled" }, original[1]],
  });
  assert.equal(second.allowed, false);
  assert.equal(second.committedIncrease, 40000);
  assert.equal(second.remaining, 10000);
});

test("compensation budget handles decreases and malformed committed reservations conservatively", () => {
  const result = evaluateCompensationCycleBudget({
    budgetPool: 20000,
    candidateProposalId: 1,
    currentAnnual: 400000,
    proposedAnnual: 390000,
    existingProposals: [{ id: 2, status: "scheduled", currentAnnual: "100000.00", proposedAnnual: "115000.00" }],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.requestedIncrease, 0);
  assert.equal(result.committedIncrease, 15000);
  assert.equal(evaluateCompensationCycleBudget({
    budgetPool: 20000,
    candidateProposalId: 1,
    currentAnnual: 100000,
    proposedAnnual: 101000,
    existingProposals: [{ id: 2, status: "applied", currentAnnual: "bad", proposedAnnual: 104000 }],
  }).allowed, false);
});

test("compensation approval rechecks cycle budget and pay state after taking transaction locks", () => {
  const fs = require("node:fs");
  const route = fs.readFileSync("src/app/api/compensation/route.ts", "utf8");
  const governance = fs.readFileSync("src/lib/hcm-compensation.ts", "utf8");
  const approvalStart = route.indexOf('if (proposal.status !== "proposed")');
  const review = route.slice(approvalStart);
  const txStart = review.indexOf("result = await db.transaction(async (tx) => {");
  const lockedBudget = review.indexOf("const lockedBudget = evaluateCompensationCycleBudget", txStart);
  const invalidation = review.indexOf("invalidatePayrollRunsForCompensationChange(", txStart);
  const revisionInsert = review.indexOf("tx.insert(employeePayRevisions)", txStart);
  assert.ok(approvalStart > 0 && txStart > 0 && lockedBudget > txStart);
  assert.ok(review.includes("pg_advisory_xact_lock(4230"));
  assert.ok(review.includes("pg_advisory_xact_lock(4221"));
  assert.ok(review.includes("liveProposals"));
  assert.ok(review.includes("liveRevisions"));
  assert.ok(invalidation > lockedBudget && revisionInsert > invalidation);
  assert.ok(review.includes("affectedRuns,\n        tx,"));
  assert.ok(review.includes("const invalidatedPayrollRunIds = result.invalidatedPayrollRunIds;"));
  assert.ok(governance.includes("return transaction ? invalidate(transaction) : db.transaction(invalidate);"));
});

test("compensation approval rollback restores payroll state when the subsequent revision fails", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Compensation Atomicity QA",
    legalName: "Compensation Atomicity QA Inc.",
    plan: "Core",
  }).returning();
  try {
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1-15 compensation atomicity",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      scopeLabel: "All locations",
      status: "Needs review",
      payDate: "2026-10-15",
      employeeCount: 1,
      processedChunks: 1,
      totalChunks: 1,
      grossPay: "100.00",
      netPay: "90.00",
    }).returning();

    await assert.rejects(db.transaction(async (tx) => {
      const affected = await compensationPayrollConflicts({
        organizationId: org.id,
        employeeOrgUnitId: null,
        effectiveFrom: "2026-10-05",
      }, tx);
      assert.equal(affected.length, 1);
      const invalidated = await invalidatePayrollRunsForCompensationChange(org.id, affected, tx);
      assert.deepEqual(invalidated, [run.id]);
      throw new Error("TEST_SIMULATED_REVISION_CONFLICT");
    }), /TEST_SIMULATED_REVISION_CONFLICT/);

    const [after] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.equal(after.status, "Needs review");
    assert.equal(after.employeeCount, 1);
    assert.equal(after.processedChunks, 1);
    assert.equal(after.grossPay, "100.00");
    assert.equal(after.netPay, "90.00");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

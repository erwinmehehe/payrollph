import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { summarizeCompensationCycleBudget } from "../src/lib/hcm-compensation-cycle-budget-preview";

const cycle = { id: 9, budgetPool: "1500.00" };
const proposals = [
  { id: 1, cycleId: 9, status: "scheduled", currentAnnual: "1000.00", proposedAnnual: "1400.25" },
  { id: 2, cycleId: 9, status: "applied", currentAnnual: "2000.00", proposedAnnual: "2100.05" },
  { id: 3, cycleId: 9, status: "proposed", currentAnnual: "1000.00", proposedAnnual: "1300.10" },
  { id: 4, cycleId: 9, status: "cancelled", currentAnnual: "0.00", proposedAnnual: "990.00" },
  { id: 5, cycleId: 9, status: "failed", currentAnnual: "0.00", proposedAnnual: "900.00" },
  { id: 6, cycleId: 18, status: "scheduled", currentAnnual: "0.00", proposedAnnual: "7777.00" },
];

test("compensation budget distinguishes committed changes from proposals awaiting review", () => {
  const v = summarizeCompensationCycleBudget(cycle, proposals);
  assert.ok(v && v.state === "available");
  assert.equal(v.committedAnnual, 500.30);
  assert.equal(v.pendingAnnual, 300.10);
  assert.equal(v.remainingAnnual, 999.70);
  assert.equal(v.overCommittedAnnual, 0);
  assert.equal(v.potentialOverBudgetAnnual, 0);
  assert.equal(v.committedCount, 2);
  assert.equal(v.pendingCount, 1);
  assert.equal(v.authorizesCompensation, false);
});

test("an overspent snapshot warns instead of clamping a negative remaining budget to zero", () => {
  const v = summarizeCompensationCycleBudget(
    { id: 9, budgetPool: "100.00" }, [
      { id: 1, cycleId: 9, status: "scheduled", currentAnnual: "0.00", proposedAnnual: "150.00" },
      { id: 2, cycleId: 9, status: "proposed", currentAnnual: "0.00", proposedAnnual: "30.00" },
    ],
  );
  assert.ok(v && v.state === "available");
  assert.equal(v.remainingAnnual, -50);
  assert.equal(v.overCommittedAnnual, 50);
  assert.equal(v.potentialOverBudgetAnnual, 80);
  assert.equal(v.authorizesCompensation, false);
});

test("only positive proposal increases consume budget; inactive proposals cannot reserve budget", () => {
  const v = summarizeCompensationCycleBudget({ id: 9, budgetPool: "1500" }, [
    { id: 1, cycleId: 9, status: "scheduled", currentAnnual: "1400", proposedAnnual: "1000" },
    { id: 2, cycleId: 9, status: "rejected", currentAnnual: "0", proposedAnnual: "300" },
    { id: 3, cycleId: 9, status: "declined", currentAnnual: "0", proposedAnnual: "300" },
    { id: 4, cycleId: 9, status: "proposed", currentAnnual: "100", proposedAnnual: "100" },
  ]);
  assert.ok(v && v.state === "available");
  assert.equal(v.committedAnnual, 0);
  assert.equal(v.pendingAnnual, 0);
  assert.equal(v.remainingAnnual, 1500);
  assert.equal(v.authorizesCompensation, false);
});

test("bad source values, duplicate proposals and unknown statuses fail closed", () => {
  assert.equal(summarizeCompensationCycleBudget(null, proposals), null);
  for (const pool of ["-1", "Infinity", "NaN", "1e4", "25.234", "999999999999999"]) {
    const v = summarizeCompensationCycleBudget({ id: 9, budgetPool: pool }, proposals);
    assert.equal(v?.state, "unavailable", pool);
  }
  for (const amount of ["-20.00", "Infinity", "100.123", "100x", "9007199254740992"]) {
    const v = summarizeCompensationCycleBudget(cycle, [
      { id: 1, cycleId: 9, status: "scheduled", currentAnnual: amount, proposedAnnual: "999.00" },
    ]);
    assert.equal(v?.state, "unavailable", amount);
  }
  assert.equal(summarizeCompensationCycleBudget(cycle, [
    { ...proposals[0] }, { ...proposals[0] },
  ])?.state, "unavailable");
  assert.equal(summarizeCompensationCycleBudget(cycle, [
    { ...proposals[0], status: "surprise_new_state" },
  ])?.state, "unavailable");
  assert.equal(summarizeCompensationCycleBudget({ id: 0, budgetPool: "50.00" }, proposals)?.state, "unavailable");
});

test("client preview is read-only and company-wide pool context stays scoped", () => {
  const panel = readFileSync("src/components/compensation-panel.tsx", "utf8");
  const helper = readFileSync("src/lib/hcm-compensation-cycle-budget-preview.ts", "utf8");
  assert.ok(panel.includes("summarizeCompensationCycleBudget(activeCycle ?? null, proposals)"));
  assert.ok(panel.includes("access?.companyWide"));
  assert.ok(panel.includes("budgetPreview.pendingCount"));
  assert.ok(panel.includes("budgetPreview.overCommittedAnnual > 0"));
  assert.ok(panel.includes("budgetPreview.potentialOverBudgetAnnual > 0"));
  assert.ok(panel.includes("awaiting independent review, not committed"));
  assert.ok(!panel.includes("Math.max(0, Number(activeCycle.budgetPool) - committedSpend)"));
  assert.ok(helper.includes("authorizesCompensation: false"));
  for (const mutation of ["db.insert(", "db.update(", "db.delete(", "fetch("]) {
    assert.ok(!helper.includes(mutation), "Preview cannot create a mutation path: " + mutation);
  }
});

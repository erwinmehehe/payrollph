import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { organizations, payrollRuns } from "../src/db/schema";
import { claimPayrollRunForRelease } from "../src/lib/payroll-period-integrity";

// The overlap exclusion constraint from drizzle/0089 is not declared in schema.ts,
// so databases built by `drizzle-kit push` (every CI database) do not have it.
// These tests therefore prove the application-level claim on its own.

async function makeOrg() {
  const marker = randomUUID().slice(0, 12);
  const [org] = await db.insert(organizations).values({ name: "Claim race " + marker, legalName: "Claim race " + marker }).returning();
  return org;
}

async function makeRun(organizationId: number, label: string, start: string, end: string, scopeOrgUnitId: number | null = null) {
  const [run] = await db.insert(payrollRuns).values({
    organizationId, periodLabel: label, periodStart: start, periodEnd: end, scopeLabel: "All locations", scopeOrgUnitId,
    status: "Ready for release", payDate: end, employeeCount: 1, grossPay: "1000.00", netPay: "900.00", ruleVersion: "PH-2026.05",
  }).returning();
  return run;
}

async function cleanup(orgIds: number[]) {
  await db.delete(payrollRuns).where(inArray(payrollRuns.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
}

test("two overlapping runs released concurrently: exactly one reaches Releasing", async () => {
  const org = await makeOrg();
  try {
    for (let round = 0; round < 12; round++) {
      const a = await makeRun(org.id, `A${round}`, "2026-10-01", "2026-10-15");
      const b = await makeRun(org.id, `B${round}`, "2026-10-10", "2026-10-25");
      const results = await Promise.all([claimPayrollRunForRelease(a), claimPayrollRunForRelease(b)]);
      const claimed = results.filter((r) => r.status === "claimed");
      const conflicts = results.filter((r) => r.status === "period-conflict");
      assert.equal(claimed.length, 1, `round ${round}: exactly one claim, got ${results.map((r) => r.status).join(",")}`);
      assert.equal(conflicts.length, 1, `round ${round}: the other is a period conflict`);
      const rows = await db.select({ id: payrollRuns.id, status: payrollRuns.status }).from(payrollRuns).where(eq(payrollRuns.organizationId, org.id));
      assert.equal(rows.filter((r) => r.status === "Releasing").length, 1, "only one overlapping run is Releasing");
      // free the period for the next round
      await db.update(payrollRuns).set({ status: "Superseded" }).where(eq(payrollRuns.organizationId, org.id));
    }
  } finally { await cleanup([org.id]); }
});

test("the same run claimed twice concurrently is claimed once", async () => {
  const org = await makeOrg();
  try {
    const run = await makeRun(org.id, "Solo", "2026-11-01", "2026-11-15");
    const results = await Promise.all([claimPayrollRunForRelease(run), claimPayrollRunForRelease(run), claimPayrollRunForRelease(run)]);
    assert.equal(results.filter((r) => r.status === "claimed").length, 1);
    assert.equal(results.filter((r) => r.status === "not-ready").length, 2);
  } finally { await cleanup([org.id]); }
});

test("independent populations are not over-serialized: disjoint periods, explicit units and other employers all claim", async () => {
  const orgA = await makeOrg();
  const orgB = await makeOrg();
  try {
    const first = await makeRun(orgA.id, "Oct first half", "2026-10-01", "2026-10-15");
    const second = await makeRun(orgA.id, "Oct second half", "2026-10-16", "2026-10-31");
    const other = await makeRun(orgB.id, "Other employer same dates", "2026-10-01", "2026-10-15");
    const results = await Promise.all([first, second, other].map((run) => claimPayrollRunForRelease(run)));
    assert.deepEqual(results.map((r) => r.status), ["claimed", "claimed", "claimed"]);
  } finally { await cleanup([orgA.id, orgB.id]); }
});

test("the release route claims through the locked helper, never with a bare status update", () => {
  const source = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  assert.match(source, /await claimPayrollRunForRelease\(run\)/);
  assert.doesNotMatch(source, /\.set\(\{ status: "Releasing" \}\)\s*\.where\(and\(eq\(payrollRuns\.id, runId\), eq\(payrollRuns\.status, "Ready for release"\)\)\)\s*\.returning\(\)/);
});

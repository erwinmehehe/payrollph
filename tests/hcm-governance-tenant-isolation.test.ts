import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, hcmBusinessProcessDefinitions, organizations, separationRecords } from "../src/db/schema";
import { loadHcmGovernanceReadiness } from "../src/lib/hcm-governance-readiness-server";

test("HCM aggregate read is strictly organization-scoped and does not reveal worker identities", async () => {
  const unique = randomUUID().slice(0, 12);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: `Governance Alpha ${unique}`, legalName: `Governance Alpha ${unique}`, plan: "Core" },
    { name: `Governance Beta ${unique}`, legalName: `Governance Beta ${unique}`, plan: "Core" },
  ]).returning();
  try {
    const [alphaEmployee] = await db.insert(employees).values({
      organizationId: alpha.id,
      employeeNo: "ONLY-ALPHA",
      firstName: "One",
      lastName: "Private",
      title: "Staff",
      status: "Active",
      avatarInitials: "OP",
      basicRate: "22000.00",
      region: "NCR",
      startDate: "2099-01-01",
    }).returning();

    await db.insert(employees).values({
      organizationId: beta.id,
      employeeNo: "ONLY-BETA",
      firstName: "Two",
      lastName: "Private",
      title: "Staff",
      status: "Active",
      avatarInitials: "TP",
      basicRate: "23000.00",
      region: "UNSUPPORTED-REGION",
      startDate: "2026-01-01",
    });
    await db.insert(hcmBusinessProcessDefinitions).values({
      organizationId: beta.id,
      code: "private-hire-review",
      name: "Beta only approval",
      processType: "hire",
      effectiveFrom: "2020-01-01",
      active: true,
      steps: [{ type: "approval", label: "Review", assignee: "role:owner" }],
    });
    await db.insert(separationRecords).values({
      organizationId: beta.id,
      employeeId: alphaEmployee.id,
      separationType: "resignation",
      noticeDate: "2026-01-01",
      lastDay: "2026-02-01",
      status: "released",
    }).then(
      () => { throw new Error("Cross-tenant separation was unexpectedly accepted."); },
      () => undefined,
    );
    // Intentionally only READ the tenant's aggregates; no migration, action
    // or PII-containing row should be returned from the service.
    const a = await loadHcmGovernanceReadiness(alpha.id);
    const b = await loadHcmGovernanceReadiness(beta.id);
    assert.equal(a.summary.employeeCount, 1);
    assert.equal(b.summary.employeeCount, 1);
    assert.equal(a.findings.find(x => x.code === "UNKNOWN_WAGE_REGION"), undefined);
    assert.equal(b.findings.find(x => x.code === "UNKNOWN_WAGE_REGION")?.affected, 1);
    assert.equal(a.findings.find(x => x.code === "FUTURE_EMPLOYMENT_START_DATE")?.affected, 1);
    assert.equal(a.processes.find(x => x.processType === "hire")?.configuredDefinitions, 0);
    assert.equal(b.processes.find(x => x.processType === "hire")?.configuredDefinitions, 1);
    for (const report of [a, b]) {
      const body = JSON.stringify(report);
      assert.ok(!body.includes("ONLY-ALPHA"));
      assert.ok(!body.includes("ONLY-BETA"));
      assert.ok(!body.includes("Private"));
      assert.ok(!body.includes("22000.00"));
      assert.ok(!body.includes("23000.00"));
    }
    await assert.rejects(() => loadHcmGovernanceReadiness(-1), /Valid organizationId/);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});

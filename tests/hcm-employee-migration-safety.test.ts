import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { organizations, hcmBusinessProcessDefinitions, payrollRuns } from "../src/db/schema";
import { employeeMasterMigrationBlockers } from "../src/lib/hcm-migration-safety";

test("pre-live tenant migration is locked once Hire BP is configured", async () => {
  const [org] = await db.insert(organizations).values({
    name: "HCM migration test",
    legalName: "HCM migration test",
    plan: "Core",
  }).returning();
  try {
    assert.deepEqual(await employeeMasterMigrationBlockers(org.id), []);
    await db.insert(hcmBusinessProcessDefinitions).values({
      organizationId: org.id,
      code: `migration-hire-${org.id}`,
      name: "Governed hire",
      processType: "hire",
      effectiveFrom: "2099-01-01",
      active: false,
      steps: [{ type: "approval", label: "Owner", assignee: "role:owner" }],
    });
    assert.ok((await employeeMasterMigrationBlockers(org.id)).some((item) => item.includes("governed Hire")));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("pre-live employee migration is locked when payroll has started", async () => {
  const [org] = await db.insert(organizations).values({
    name: "HCM payroll migration test",
    legalName: "HCM payroll migration test",
    plan: "Core",
  }).returning();
  try {
    await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Migration safety test",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-15",
      payDate: "2026-08-15",
      scopeLabel: "All locations",
      employeeCount: 0,
      status: "Draft",
    });
    assert.ok((await employeeMasterMigrationBlockers(org.id)).some((item) => item.includes("Payroll runs")));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("migration path requires HR source evidence and encrypts government identity fields", () => {
  const source = readFileSync("src/app/api/migrations/route.ts", "utf8");
  const ui = readFileSync("src/components/migration-center.tsx", "utf8");
  assert.ok(source.includes("employeeMasterMigrationBlockers(organizationId)"));
  assert.ok(source.includes('code: "HCM_MIGRATION_LOCKED"'));
  assert.ok(source.includes('code: "HCM_MIGRATION_EVIDENCE_REQUIRED"'));
  assert.ok(source.includes("protectedGovernmentIds"));
  assert.ok(source.includes("encryptGovernmentId(row.tin"));
  assert.ok(!source.includes("tin: row.tin,"));
  assert.ok(!source.includes("startDate: row.startDate ?? today()"));
  assert.ok(source.includes("if (!existing && !row.startDate) continue"));
  assert.ok(ui.includes('form.set("evidenceReference"'));
  assert.ok(ui.includes("preview.migrationBlockers"));
});

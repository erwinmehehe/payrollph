import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { hcmBusinessProcessDefinitions, organizations } from "../src/db/schema";
import { hasConfiguredHireBusinessProcess } from "../src/lib/hcm-direct-entry-policy";

test("configured Hire BP is binding even if disabled or future-dated", async () => {
  const [org] = await db.insert(organizations).values({
    name: "HCM intake gate test",
    legalName: "HCM intake gate test",
    plan: "Core",
  }).returning();
  try {
    assert.equal(await hasConfiguredHireBusinessProcess(org.id), false);
    await db.insert(hcmBusinessProcessDefinitions).values({
      organizationId: org.id,
      code: `hire-intake-${org.id}`,
      name: "Owner-reviewed hire",
      processType: "hire",
      effectiveFrom: "2099-01-01",
      active: false,
      steps: [{ type: "approval", label: "Owner", assignee: "role:owner" }],
    });
    assert.equal(await hasConfiguredHireBusinessProcess(org.id), true);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("standalone and CSV routes reject bypass when Hire BP is configured", () => {
  const direct = readFileSync("src/app/api/employees/route.ts", "utf8");
  const bulk = readFileSync("src/app/api/employees/import/route.ts", "utf8");
  for (const source of [direct, bulk]) {
    assert.match(source, /await hasConfiguredHireBusinessProcess\(organizationId\)/);
    assert.match(source, /Response\.json\(GOVERNED_HIRE_REQUIRED, \{ status: 409 \}\)/);
  }
});

test("CSV must not update existing employment, pay, status or bank records", () => {
  const bulk = readFileSync("src/app/api/employees/import/route.ts", "utf8");
  assert.ok(bulk.includes("knownNumbers.has(row.employeeNo)"));
  assert.ok(bulk.includes("skippedExistingCount += 1"));
  assert.ok(!bulk.includes("db.update(employees)"));
  assert.ok(!bulk.includes("tx.update(employees)"));
  assert.ok(bulk.includes("db.transaction(async (tx)"));
  assert.ok(bulk.includes("tx.insert(auditEvents)"));
  assert.ok(bulk.includes("pg_advisory_xact_lock"));
  assert.ok(bulk.includes("startDate: row.startDate"));
});

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeeMweClassifications,
  employees,
  organizations,
  users,
} from "../src/db/schema";
import {
  createMweClassificationRequest,
  decideMweClassificationRequest,
  resolveMweClassification,
} from "../src/lib/mwe-classification";

test("approved effective-dated MWE evidence overrides the legacy employee boolean", () => {
  const rows = [{
    id: 7,
    employeeId: 99,
    isMwe: false,
    region: "NCR",
    employeeDailyWage: "900.00",
    statutoryMinimumWage: "755.00",
    wageOrderReference: "WO-NCR-28",
    evidenceReference: "HR wage-classification packet #2026-10",
    effectiveFrom: "2026-10-01",
    effectiveUntil: null,
    status: "approved",
  }];
  const resolved = resolveMweClassification(rows, "2026-10-15", true);
  assert.equal(resolved.isMwe, false);
  assert.equal(resolved.source, "approved");
  assert.equal(resolved.governanceMissing, false);
  assert.equal(resolved.classificationId, 7);
});

test("legacy MWE=true remains calculable but is explicitly marked governance-missing", () => {
  const resolved = resolveMweClassification([], "2026-10-15", true);
  assert.equal(resolved.isMwe, true);
  assert.equal(resolved.source, "legacy_boolean");
  assert.equal(resolved.governanceMissing, true);
});

test("MWE classification uses maker-checker approval and persists effective wage evidence", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const [org] = await db.insert(organizations).values({
    name: `MWE Governance ${suffix}`,
    legalName: `MWE Governance ${suffix} Inc.`,
  }).returning();
  const people = await db.insert(users).values([
    { email: `mwe-maker-${suffix}@example.com`, name: "MWE Maker", passwordHash: "test-only", role: "hr" },
    { email: `mwe-checker-${suffix}@example.com`, name: "MWE Checker", passwordHash: "test-only", role: "checker" },
  ]).returning();
  const maker = people[0];
  const checker = people[1];

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: `MWE-${suffix}`.slice(0, 32),
      firstName: "Maria",
      lastName: "Wage",
      title: "Associate",
      avatarInitials: "MW",
      basicRate: "16610.00",
      mwe: true,
      region: "NCR",
      startDate: "2026-01-01",
    }).returning();

    const request = await createMweClassificationRequest({
      organizationId: org.id,
      employeeId: employee.id,
      isMwe: true,
      region: "NCR",
      employeeDailyWage: 755,
      statutoryMinimumWage: 755,
      wageOrderReference: "WO-NCR-28 · applicable employer tier verified",
      evidenceReference: "Payroll tax evidence packet MWE-2026-001",
      effectiveFrom: "2026-10-01",
      requestedByUserId: maker.id,
      requestedByName: maker.name,
    });
    assert.equal(request.status, "pending");

    const self = await decideMweClassificationRequest({
      organizationId: org.id,
      classificationId: request.id,
      decidedByUserId: maker.id,
      decidedByName: maker.name,
      decision: "approve",
    });
    assert.equal(self.kind, "forbidden");

    const approved = await decideMweClassificationRequest({
      organizationId: org.id,
      classificationId: request.id,
      decidedByUserId: checker.id,
      decidedByName: checker.name,
      decision: "approve",
      decisionNote: "Applicable wage order and payroll evidence reviewed.",
    });
    assert.equal(approved.kind, "approved");

    const rows = await db.select().from(employeeMweClassifications)
      .where(eq(employeeMweClassifications.employeeId, employee.id));
    const resolved = resolveMweClassification(rows.map((row) => ({
      ...row,
      employeeDailyWage: row.employeeDailyWage,
      statutoryMinimumWage: row.statutoryMinimumWage,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    })), "2026-10-15", true);
    assert.equal(resolved.source, "approved");
    assert.equal(resolved.isMwe, true);
    assert.equal(resolved.wageOrderReference, "WO-NCR-28 · applicable employer tier verified");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, maker.id));
    await db.delete(users).where(eq(users.id, checker.id));
  }
});


test("MWE governance is enforced consistently in migration, schema, compatibility upgrade and payroll runtime", () => {
  const migration = readFileSync("drizzle/0093_mwe_classification_governance.sql", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  const assurance = readFileSync("src/lib/payroll-assurance-server.ts", "utf8");
  const requestRoute = readFileSync("src/app/api/employees/[id]/mwe-classifications/route.ts", "utf8");
  const decisionRoute = readFileSync("src/app/api/employees/[id]/mwe-classifications/[classificationId]/route.ts", "utf8");

  for (const source of [migration, schema, compat]) {
    assert.ok(source.includes("employee_mwe_classifications"));
    assert.ok(source.includes("wage_order_reference"));
    assert.ok(source.includes("evidence_reference"));
    assert.ok(source.includes("requested_by_user_id"));
    assert.ok(source.includes("decided_by_user_id"));
  }
  assert.ok(migration.includes("employee_mwe_classifications_no_approved_overlap"));
  assert.ok(compat.includes("employee_mwe_classifications_no_approved_overlap"));
  assert.ok(compat.includes("WHEN duplicate_table THEN NULL"));
  assert.ok(migration.includes("WHEN duplicate_table THEN NULL"));
  assert.ok(engine.includes("resolveMweClassification"));
  assert.ok(engine.includes("mweClassificationSource="));
  assert.ok(assurance.includes("MWE_CLASSIFICATION_GOVERNANCE"));
  assert.ok(requestRoute.includes("requireSensitiveActionMfa"));
  assert.ok(decisionRoute.includes("PAYROLL_TAX_APPROVER_ROLES"));
  assert.ok(decisionRoute.includes("requireSensitiveActionMfa"));
});


test("demo fixtures do not misclassify the ₱21,800 monthly warehouse worker as MWE", () => {
  const publicDemo = readFileSync("src/db/public-demo.ts", "utf8");
  const seed = readFileSync("src/db/seed.ts", "utf8");
  assert.ok(publicDemo.includes("mwe: false"));
  assert.ok(!publicDemo.includes("mwe: index === 5"));
  assert.ok(seed.includes('["Rico", "Mendoza", "Warehouse Officer", "RM", "Disciplinary review", "Regular", "21800.00", false'));
});

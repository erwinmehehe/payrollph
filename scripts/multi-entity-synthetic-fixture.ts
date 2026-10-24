import assert from "node:assert/strict";
import { db } from "../src/db";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../src/lib/crypto";
import {
  employees, employeePayProfiles, legalEntities, orgUnits, organizations, payrollRuns,
  userLegalEntityGrants, userOrganizations, users,
} from "../src/db/schema";

/**
 * Disposable two-tenant / two-employer fixture for actual authenticated UI
 * tests. Refuses to operate outside a local CI PostgreSQL database.
 */
async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/app_db");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");

  // The registration-only column is deliberately absent from legacy ORM
  // tables. Add it only inside this verified disposable acceptance fixture.
  await db.execute(sql`ALTER TABLE legal_entities ADD COLUMN IF NOT EXISTS registered_address text`);
  // Only feature-on SQL needs these proposed attribution columns. The
  // shared ORM remains usable before their separately reviewed migration.
  for (const table of ["payroll_entries", "payroll_jobs", "payslips",
    "payout_batches", "payout_transfers", "bank_file_validations",
    "year_end_adjustments", "historical_payroll_entries", "separation_records"]) {
    await db.execute(sql.raw(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS legal_entity_id integer`));
  }

  const [tenantA, tenantB, tenantC] = await db.insert(organizations).values([
    { name: "Synthetic Group A", legalName: "Synthetic Group A", plan: "Core" },
    { name: "Synthetic Tenant B", legalName: "Synthetic Tenant B", plan: "Core" },
    { name: "Synthetic Tenant C", legalName: "Synthetic Tenant C", plan: "Core" },
  ]).returning();
  assert.deepEqual([tenantA.id, tenantB.id, tenantC.id], [1, 2, 3],
    "Expected an empty disposable database");
  const [a1, a2, b1, c1] = await db.insert(legalEntities).values([
    { organizationId: tenantA.id, code: "PRIMARY", legalName: "Alpha Legal Employer", displayName: "Alpha Legal", primaryEntity: true },
    { organizationId: tenantA.id, code: "SECOND", legalName: "Beta Legal Employer", displayName: "Beta Legal" },
    { organizationId: tenantB.id, code: "PRIMARY", legalName: "Foreign Legal Employer", displayName: "Foreign Legal", primaryEntity: true },
    { organizationId: tenantC.id, code: "PRIMARY", legalName: "Third Legal Employer", displayName: "Third Legal", primaryEntity: true },
  ]).returning();
  // Deterministic sub-millisecond source timestamp: JS Date cannot represent
  // its final 437 microseconds, while PostgreSQL equality must remain exact.
  // Only fictional employer B on disposable localhost PostgreSQL is touched.
  await db.update(legalEntities).set({
    updatedAt: sql<Date>`date_trunc('milliseconds', current_timestamp) + interval '437 microseconds'`,
  }).where(eq(legalEntities.id, a2.id));
  const [unit] = await db.insert(orgUnits).values({
    organizationId: tenantA.id, type: "department", code: "HR-RESTRICTED",
    name: "Synthetic Restricted Group", legalEntityId: a1.id,
  }).returning();
  const passwordHash = hashPassword("Synthetic-Entity-QA-2026-Only!");
  const members = await db.insert(users).values([
    { email: "entity-group@example.test", name: "Synthetic Group HR", role: "group_hr", passwordHash },
    { email: "entity-group-unit@example.test", name: "Synthetic Restricted Group HR", role: "group_hr", passwordHash },
    { email: "entity-owner@example.test", name: "Synthetic Owner", role: "owner", passwordHash },
    { email: "entity-hr@example.test", name: "Synthetic Scoped HR", role: "hr", passwordHash },
    { email: "entity-payroll@example.test", name: "Synthetic Scoped Payroll", role: "payroll", passwordHash },
    { email: "entity-nogrant@example.test", name: "Synthetic Owner Without Grant", role: "owner", passwordHash },
    { email: "entity-foreign@example.test", name: "Synthetic Foreign Owner", role: "owner", passwordHash },
    { email: "entity-checker@example.test", name: "Synthetic Independent Checker", role: "admin", passwordHash },
    { email: "entity-attacker-b@example.test", name: "Tenant B Group Reader", role: "group_hr", passwordHash },
    { email: "entity-attacker-c@example.test", name: "Tenant C Group Reader", role: "group_hr", passwordHash },
  ]).returning();
  await db.insert(userOrganizations).values([
    { userId: members[0].id, organizationId: tenantA.id, role: "group_hr", active: true },
    { userId: members[1].id, organizationId: tenantA.id, role: "group_hr", orgUnitId: unit.id, active: true },
    { userId: members[2].id, organizationId: tenantA.id, role: "owner", active: true },
    { userId: members[3].id, organizationId: tenantA.id, role: "hr", active: true },
    { userId: members[4].id, organizationId: tenantA.id, role: "payroll", active: true },
    { userId: members[5].id, organizationId: tenantA.id, role: "owner", active: true },
    { userId: members[6].id, organizationId: tenantB.id, role: "owner", active: true },
    { userId: members[7].id, organizationId: tenantA.id, role: "admin", active: true },
    { userId: members[8].id, organizationId: tenantB.id, role: "group_hr", active: true },
    { userId: members[9].id, organizationId: tenantC.id, role: "group_hr", active: true },
  ]);
  await db.insert(userLegalEntityGrants).values([
    { organizationId: tenantA.id, userId: members[2].id, legalEntityId: a1.id },
    { organizationId: tenantA.id, userId: members[2].id, legalEntityId: a2.id },
    { organizationId: tenantA.id, userId: members[3].id, legalEntityId: a1.id },
    { organizationId: tenantA.id, userId: members[4].id, legalEntityId: a1.id },
    { organizationId: tenantB.id, userId: members[6].id, legalEntityId: b1.id },
    { organizationId: tenantA.id, userId: members[7].id, legalEntityId: a1.id },
    { organizationId: tenantA.id, userId: members[7].id, legalEntityId: a2.id },
  ]);
  const baseEmployees = await db.insert(employees).values([
    { organizationId: tenantA.id, legalEntityId: a1.id, employeeNo: "A-01",
      firstName: "Alpha", lastName: "Synthetic", title: "Staff",
      avatarInitials: "AS", basicRate: "20000", startDate: "2026-01-01" },
    { organizationId: tenantA.id, legalEntityId: a2.id, employeeNo: "A-02",
      firstName: "Beta", lastName: "Synthetic", title: "Staff",
      avatarInitials: "BS", basicRate: "24000", startDate: "2026-01-01" },
    { organizationId: tenantB.id, legalEntityId: b1.id, employeeNo: "B-01",
      firstName: "Foreign", lastName: "Synthetic", title: "Staff",
      avatarInitials: "FS", basicRate: "28000", startDate: "2026-01-01" },
    { organizationId: tenantC.id, legalEntityId: c1.id, employeeNo: "C-01",
      firstName: "Third", lastName: "Synthetic", title: "Staff",
      avatarInitials: "TS", basicRate: "30000", startDate: "2026-01-01" },
  ]).returning({ id: employees.id, organizationId: employees.organizationId,
    employeeNo: employees.employeeNo, basicRate: employees.basicRate });
  // Eight additional B-only workers give the cross-tenant negative proof
  // real, read-back employee IDs above 6 (not fabricated 1..6 probes).
  const bVictimEmployees = await db.insert(employees).values(Array.from({ length: 8 }, (_, index) => ({
    organizationId: tenantB.id, legalEntityId: b1.id,
    employeeNo: "B-VICTIM-" + index,
    firstName: "Victim" + index, lastName: "Fictional", title: "Staff",
    avatarInitials: "VF", basicRate: "15000", startDate: "2026-01-01",
  }))).returning({ id: employees.id, organizationId: employees.organizationId,
    employeeNo: employees.employeeNo, basicRate: employees.basicRate });

  // #1334 retired request-time pay-profile backfills. Seed one explicitly
  // per just-created fictional worker, before any authenticated app reads.
  // This is fixture creation on an empty disposable CI database, never a
  // repair of historical customer compensation or any real payroll record.
  const syntheticWorkers = [...baseEmployees, ...bVictimEmployees];
  assert.equal(syntheticWorkers.length, 12, "Expected all fictional workers");
  assert.deepEqual(syntheticWorkers.map(worker => worker.organizationId), [
    tenantA.id, tenantA.id, tenantB.id, tenantC.id, ...Array(8).fill(tenantB.id),
  ], "Pay profiles may only be seeded for the explicitly known tenant roster");
  // The latest main also pins the exact fictional employee number, tenant and
  // rate before fixture pay-profile creation. No customer rows are repaired.
  const expectedProfiles = [
    { employeeNo: "A-01", organizationId: tenantA.id, rateAmount: "20000.00" },
    { employeeNo: "A-02", organizationId: tenantA.id, rateAmount: "24000.00" },
    { employeeNo: "B-01", organizationId: tenantB.id, rateAmount: "28000.00" },
    { employeeNo: "C-01", organizationId: tenantC.id, rateAmount: "30000.00" },
    ...Array.from({ length: 8 }, (_, index) => ({
      employeeNo: "B-VICTIM-" + index, organizationId: tenantB.id,
      rateAmount: "15000.00",
    })),
  ];
  const byEmployeeNo = new Map(syntheticWorkers.map(worker => [worker.employeeNo, worker]));
  assert.equal(byEmployeeNo.size, expectedProfiles.length, "Fictional roster must be unique");
  assert.equal(syntheticWorkers.length, expectedProfiles.length, "Fictional roster count must be exact");
  for (const expected of expectedProfiles) {
    const worker = byEmployeeNo.get(expected.employeeNo);
    assert.ok(worker, "Verified fictional worker must exist");
    assert.equal(worker.organizationId, expected.organizationId, "Cross-tenant profile refused");
    assert.equal(worker.basicRate, expected.rateAmount, "Fixture pay rate drift refused");
  }
  const insertedProfiles = await db.insert(employeePayProfiles).values(syntheticWorkers.map(worker => ({
    organizationId: worker.organizationId, employeeId: worker.id,
    payBasis: "monthly", rateAmount: worker.basicRate,
    standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
  }))).returning({ employeeId: employeePayProfiles.employeeId });
  assert.equal(insertedProfiles.length, syntheticWorkers.length,
    "Every synthetic worker requires an explicit pay profile before an app request");
  const profiles = await db.select({
    employeeId: employeePayProfiles.employeeId,
    organizationId: employeePayProfiles.organizationId,
    rateAmount: employeePayProfiles.rateAmount,
  }).from(employeePayProfiles);
  assert.equal(profiles.length, syntheticWorkers.length,
    "Every synthetic worker must have exactly one explicit pay profile");
  for (const worker of syntheticWorkers) {
    const profile = profiles.find(row => row.employeeId === worker.id);
    assert.ok(profile, "An explicit synthetic worker pay profile is required");
    assert.equal(profile.organizationId, worker.organizationId,
      "Pay profiles must never cross organization boundaries");
    assert.equal(profile.rateAmount, worker.basicRate,
      "Fixture rate must equal the fictional worker's explicitly seeded rate");
  }
  await db.insert(payrollRuns).values([
    { organizationId: tenantA.id, legalEntityId: a1.id,
      periodLabel: "Alpha employer draft", periodStart: "2026-10-01",
      periodEnd: "2026-10-15", payDate: "2026-10-15", status: "Draft" },
    { organizationId: tenantA.id, legalEntityId: a2.id,
      periodLabel: "Beta employer draft", periodStart: "2026-10-01",
      periodEnd: "2026-10-15", payDate: "2026-10-15", status: "Draft" },
  ]);
  console.log(JSON.stringify({
    syntheticOnly: true, tenantCount: 3, legalEmployerCount: 4,
    employees: 12, payoutEvents: 0, filingEvents: 0, externalCalls: 0,
  }));
}
main().catch(error => {
  // No query params, credentials, raw IDs or PII in CI logs.
  console.error("Multi-entity local fixture failed (" +
    (error instanceof Error ? error.name : "unknown") + ").");
  process.exitCode = 1;
});

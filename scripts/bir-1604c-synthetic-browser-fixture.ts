import { computeFinalPay } from "../src/lib/final-pay";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { db, pool } from "../src/db";
import {
  organizations, employees, users, userOrganizations, subscriptions,
  legalEntities, payrollRuns, payrollEntries, yearEndAdjustments, separationRecords,
  birWithholdingRemittanceBatches, employeePayProfiles,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/crypto";
import { encryptTotpSecret } from "../src/lib/security-secret";
import { encryptGovernmentId } from "../src/lib/government-id-crypto";

async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.BIR_SYNTHETIC_BROWSER_QA, "true");
  assert.equal(new URL(process.env.DATABASE_URL ?? "").hostname, "127.0.0.1");
  assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, "/app_db");
  assert.equal((await db.select().from(organizations)).length, 0, "Disposable empty PostgreSQL required");
  const [org] = await db.insert(organizations)
    .values({ name: "Synthetic BIR annual browser test", legalName: "Synthetic Employer Co.", birTin: "123456789", birBranchCode: "0000" })
    .returning();
  const [entity] = await db.insert(legalEntities).values({
    organizationId: org.id, code: "SYN-1604C",
    legalName: "Synthetic Employer Co.", displayName: "Synthetic 1604C",
    birTin: "123456789", birBranchCode: "0000", active: true, primaryEntity: true,
  }).returning();
  const [employee] = await db.insert(employees).values({
    organizationId: org.id, legalEntityId: entity.id, employeeNo: "SYN-BIR-001",
    firstName: "Maria", middleName: "", lastName: "Santos",
    title: "Synthetic QA", avatarInitials: "MS", basicRate: "50000.00",
    nationality: "Filipino", startDate: "2025-01-01", birthDate: "1990-02-03",
    tin: encryptGovernmentId("333222111", { required: true }),
    tinBranchCode: encryptGovernmentId("0000", { required: true }),
  }).returning();
  // CI-only worker must have an explicit pay profile before opening /app.
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: org.id, payBasis: "monthly",
    rateAmount: "50000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
  });
  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id, legalEntityId: entity.id,
    periodLabel: "Synthetic December 2025",
    periodStart: "2025-12-01", periodEnd: "2025-12-31",
    payDate: "2025-12-31", status: "Released", employeeCount: 1,
    grossPay: "600000.00", netPay: "557500.00",
  }).returning();
  const [entry] = await db.insert(payrollEntries).values({
    payrollRunId: run.id, employeeId: employee.id,
    grossPay: "600000.00", deductions: "42500.00", netPay: "557500.00",
    lineItems: [{ code: "WHT", amount: "-42500.00" }],
    status: "Ready",
  }).returning();
  await db.insert(yearEndAdjustments).values({
    organizationId: org.id, employeeId: employee.id, taxYear: 2025,
    grossCompensation: "600000.00", thirteenthMonth: "50000.00",
    nonTaxable: "100000.00", taxableIncome: "500000.00",
    taxDue: "42500.00", taxWithheld: "42500.00", adjustment: "0.00",
    mwe: false, status: "settled",
  });
  await db.insert(birWithholdingRemittanceBatches).values({
    organizationId: org.id, legalEntityId: entity.id,
    applicableMonth: "2025-12", filingChannel: "ebirforms",
    filingDueDate: "2026-01-10", paymentDueDate: "2026-01-10",
    status: "reconciled", employeeCount: 1, payrollRunCount: 1,
    expectedTaxWithheld: "42500.00", amountPaid: "42500.00",
    snapshotHash: "a".repeat(64), createdBy: "Synthetic only",
  });
  const totpSecret = encryptTotpSecret("JBSWY3DPEHPK3PXP");
  const actorIds: number[] = [];
  for (const role of ["owner", "hr", "employee", "payroll"]) {
    const [user] = await db.insert(users).values({
      name: "Synthetic " + role,
      email: role + "@bir-qa.example.test",
      passwordHash: hashPassword("Synthetic-BIR-Only-2025!"),
      role, totpEnabled: true, totpSecret,
      employeeId: role === "employee" ? employee.id : null,
    }).returning();
    actorIds.push(user.id);
    await db.insert(userOrganizations).values({
      userId: user.id, organizationId: org.id, role,
    });
  }
  // Fictional historical shortfall record: no release action or money movement.
  const final = computeFinalPay({ releasedBasicYtd: 600000, historicalBasicYtd: 0, unpaidBasicSalary: 1000,
    thirteenthPaidYtd: 50000, grossCompensationYtd: 600000, statutoryContributionsYtd: 0,
    taxWithheldYtd: 42500, mwe: false, leaveMonetizationPay: 0, separationPay: 0,
    retirementPay: 0, otherBenefits: 0, loanDeductions: 0 });
  const [separation] = await db.insert(separationRecords).values({ organizationId: org.id, employeeId: employee.id,
    separationType: "resignation", noticeDate: "2025-12-01", lastDay: "2025-12-31", status: "released",
    releasedAt: new Date("2025-12-31T02:00:00Z"), releaseReference: "Fictional legacy shortfall only", preparedByUserId: actorIds[0],
    approvedByUserId: actorIds[1], releasedByUserId: actorIds[2], taxAdjustment: String(final.taxAdjustment),
    grossFinalPay: String(final.grossFinalPay), netFinalPay: String(final.netFinalPay),
    computationSnapshot: { annualization: final.annualization, appliedTaxCollection: final.appliedTaxCollection,
      unpaidTaxWithholding: final.unpaidTaxWithholding, sourceFingerprint: { employeeLegalEntityId: entity.id,
        released: [{ entryId: entry.id, runId: run.id, periodStart: run.periodStart, periodEnd: run.periodEnd,
          payDate: run.payDate, grossPay: Number(entry.grossPay), lineItems: entry.lineItems, trace: entry.trace }] } },
  }).returning();
  await db.insert(subscriptions).values({ organizationId: org.id, plan: "Core", status: "active" });
  writeFileSync("/tmp/bir-1604c-qa-fixture.json", JSON.stringify({
    organizationId: org.id, legalEntityId: entity.id,
    employeeNo: employee.employeeNo, employeeId: employee.id, year: 2025, separationId: separation.id,
    actualFinalWithheld: 42500 + final.appliedTaxCollection, uncollectedTax: final.unpaidTaxWithholding,
  }), { mode: 0o600 });
  console.log("Synthetic 1604-C employer/year/identity and MFA personas seeded; no live accounts or actual BIR evidence.");
  await pool.end();
}
main().catch(error => {
  console.error("Synthetic BIR fixture creation failed (no private values are logged).");
  console.error(error instanceof Error ? error.name : "unknown");
  process.exitCode = 1;
});

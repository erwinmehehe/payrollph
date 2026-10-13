import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { db, pool } from "../src/db";
import {
  organizations, employees, users, userOrganizations, subscriptions,
  legalEntities, payrollRuns, payrollEntries, yearEndAdjustments,
  birWithholdingRemittanceBatches,
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
    .values({ name: "Synthetic BIR annual browser test", legalName: "Synthetic Employer Co." })
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
    nationality: "Filipino", startDate: "2026-01-01",
    tin: encryptGovernmentId("333222111", { required: true }),
    tinBranchCode: encryptGovernmentId("0000", { required: true }),
  }).returning();
  const [run] = await db.insert(payrollRuns).values({
    organizationId: org.id, legalEntityId: entity.id,
    periodLabel: "Synthetic December 2026",
    periodStart: "2026-12-01", periodEnd: "2026-12-31",
    payDate: "2026-12-31", status: "Released", employeeCount: 1,
    grossPay: "600000.00", netPay: "595000.00",
  }).returning();
  await db.insert(payrollEntries).values({
    payrollRunId: run.id, employeeId: employee.id,
    grossPay: "600000.00", deductions: "5000.00", netPay: "595000.00",
    lineItems: [{ code: "WHT", amount: "-5000.00" }],
    status: "Ready",
  });
  await db.insert(yearEndAdjustments).values({
    organizationId: org.id, employeeId: employee.id, taxYear: 2026,
    grossCompensation: "600000.00", thirteenthMonth: "50000.00",
    nonTaxable: "100000.00", taxableIncome: "500000.00",
    taxDue: "5000.00", taxWithheld: "5000.00", adjustment: "0.00",
    mwe: false, status: "settled",
  });
  await db.insert(birWithholdingRemittanceBatches).values({
    organizationId: org.id, legalEntityId: entity.id,
    applicableMonth: "2026-12", filingChannel: "ebirforms",
    filingDueDate: "2027-01-10", paymentDueDate: "2027-01-10",
    status: "reconciled", employeeCount: 1, payrollRunCount: 1,
    expectedTaxWithheld: "5000.00", amountPaid: "5000.00",
    snapshotHash: "a".repeat(64), createdBy: "Synthetic only",
  });
  const totpSecret = encryptTotpSecret("JBSWY3DPEHPK3PXP");
  for (const role of ["owner", "hr", "employee"]) {
    const [user] = await db.insert(users).values({
      name: "Synthetic " + role,
      email: role + "@bir-qa.example.test",
      passwordHash: hashPassword("Synthetic-BIR-Only-2026!"),
      role, totpEnabled: true, totpSecret,
      employeeId: role === "employee" ? employee.id : null,
    }).returning();
    await db.insert(userOrganizations).values({
      userId: user.id, organizationId: org.id, role,
    });
  }
  await db.insert(subscriptions).values({ organizationId: org.id, plan: "Core", status: "active" });
  writeFileSync("/tmp/bir-1604c-qa-fixture.json", JSON.stringify({
    organizationId: org.id, legalEntityId: entity.id,
    employeeNo: employee.employeeNo, year: 2026,
  }), { mode: 0o600 });
  console.log("Synthetic 1604-C employer/year/identity and MFA personas seeded; no live accounts or actual BIR evidence.");
  await pool.end();
}
main().catch(error => {
  console.error("Synthetic BIR fixture creation failed (no private values are logged).");
  console.error(error instanceof Error ? error.name : "unknown");
  process.exitCode = 1;
});

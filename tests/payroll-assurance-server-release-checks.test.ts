import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { employeePayoutChangeRequests, employees, organizations, payrollEntries, payrollRuns, users } from "../src/db/schema";
import { buildPayrollAssurance } from "../src/lib/payroll-assurance-server";
import { encryptBankAccount } from "../src/lib/bank-account-crypto";

/** Fictional employers only. Encrypted accounts use a fresh random IV each time, so equal accounts must still match. */
test("assurance server: shared destinations match across encryptions, and another employer's rows never leak in", async () => {
  const tag = randomUUID().slice(0, 8);
  const [orgA, orgB] = await db.insert(organizations).values([
    { name: "Assurance A " + tag, legalName: "Assurance A " + tag, plan: "Core" },
    { name: "Assurance B " + tag, legalName: "Assurance B " + tag, plan: "Core" },
  ]).returning({ id: organizations.id });
  const orgIds = [orgA.id, orgB.id];
  try {
    const staff = async (organizationId: number, no: string, account: string, bankCode = "BPI") =>
      (await db.insert(employees).values({
        organizationId, employeeNo: no, firstName: "Fict", lastName: no, title: "Staff", avatarInitials: "FS",
        basicRate: "30000.00", startDate: "2025-01-01", bankCode, bankAccount: encryptBankAccount(account),
      }).returning())[0];
    const a1 = await staff(orgA.id, "A-1", "1234 5678 90");
    const a2 = await staff(orgA.id, "A-2", "1234-5678-90"); // same account, different formatting and a different IV
    const a3 = await staff(orgA.id, "A-3", "9999 0000 11");
    const a4 = await staff(orgA.id, "A-4", "1234567890", "UBP"); // same digits, different bank: not the same destination
    const b1 = await staff(orgB.id, "B-1", "1234567890"); // same account in ANOTHER employer: never a duplicate here
    const [run] = await db.insert(payrollRuns).values({
      organizationId: orgA.id, periodLabel: "Assurance run " + tag, periodStart: "2026-10-01", periodEnd: "2026-10-15",
      payDate: "2026-10-15", status: "Needs review", employeeCount: 4, totalChunks: 1, processedChunks: 1,
    }).returning();
    await db.insert(payrollEntries).values([a1, a2, a3, a4].map((worker) => ({
      payrollRunId: run.id, employeeId: worker.id, grossPay: "52000.00", deductions: "2000.00", netPay: "50000.00", status: "Ready",
      lineItems: [{ code: "BASIC", label: "Basic", amount: "52000.00" }, { code: "SSS", label: "SSS", amount: "-2000.00" }],
      trace: { inputs: ["punches=10", "payBasis=monthly"] },
    })));
    const [owner] = await db.insert(users).values({ email: "assurance-" + tag + "@example.invalid", name: "Assurance " + tag, passwordHash: "x", role: "owner" }).returning();
    // An applied destination change for a3 (own employer) and one for b1 (other employer, must be ignored for A's run).
    await db.insert(employeePayoutChangeRequests).values([
      { organizationId: orgA.id, employeeId: a3.id, status: "approved", reason: "Fictional", originalSnapshot: {}, originalStateSha256: "0".repeat(64), requestedByUserId: owner.id, requestedByName: "Fictional", appliedAt: new Date("2026-10-10T02:00:00Z") },
      { organizationId: orgB.id, employeeId: b1.id, status: "approved", reason: "Fictional", originalSnapshot: {}, originalStateSha256: "0".repeat(64), requestedByUserId: owner.id, requestedByName: "Fictional", appliedAt: new Date("2026-10-12T02:00:00Z") },
      // A row stamped with the OTHER employer but pointing at an own-employer employee must not count either.
      { organizationId: orgB.id, employeeId: a1.id, status: "approved", reason: "Fictional", originalSnapshot: {}, originalStateSha256: "0".repeat(64), requestedByUserId: owner.id, requestedByName: "Fictional", appliedAt: new Date("2026-10-12T02:00:00Z") },
    ]);

    const result = await buildPayrollAssurance(run.id);
    assert.ok(result);
    const duplicates = result.assurance.findings.filter((finding) => finding.code === "DUPLICATE_PAYEE_ACCOUNT");
    assert.deepEqual(duplicates.map((finding) => finding.employeeId).sort((x, y) => x! - y!), [a1.id, a2.id].sort((x, y) => x - y),
      "A-1 and A-2 match despite different IVs and formatting; A-3, A-4 (other bank) and B-1 (other employer) do not");
    assert.ok(duplicates.every((finding) => !finding.blocking && !/1234|9999/.test(JSON.stringify(finding))), "no account digits leak");
    const fresh = result.assurance.findings.filter((finding) => finding.code === "NEW_PAYOUT_DESTINATION_LARGE_PAY");
    assert.deepEqual(fresh.map((finding) => finding.employeeId), [a3.id], "only the own-employer applied change counts; the other employer's rows are ignored even when they name an own employee");
  } finally {
    await db.delete(employeePayoutChangeRequests).where(inArray(employeePayoutChangeRequests.organizationId, orgIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
    await db.delete(users).where(eq(users.email, "assurance-" + tag + "@example.invalid"));
  }
});

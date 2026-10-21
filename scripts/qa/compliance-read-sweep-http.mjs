/**
 * Real disposable PostgreSQL and localhost HTTP verification of employer-scoped
 * DOLE reports and government-loan remittance reads/writes. Synthetic only:
 * no real portal acknowledgements, agency payments, filing, or money movement.
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  doleReportingProfiles, doleComplianceSubmissions, employeeLoans,
  governmentLoanRemittanceBatches, governmentLoanRemittanceMembers,
} from "../../src/db/schema";

export async function verifyComplianceReadSweep(f, { request, expectStatus }) {
  if (process.env.CI !== "true" ||
      process.env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      new URL(process.env.DATABASE_URL).hostname !== "127.0.0.1" ||
      new URL(process.env.SECURITY_SMOKE_URL).hostname !== "127.0.0.1") {
    throw Error("Compliance proof refuses non-disposable environments");
  }
  const victim = f.orgs[0], year = 2026;
  // Existing real Released payroll produces the genuine own-employer source rows.
  const victimGet = expectStatus(await request(
    "/api/compliance/dole-13th-month?organizationId=" + victim.id +
    "&taxYear=" + year, { cookie: f.ownerSessions[0].cookie }),
    200, "Signed-in victim reads actual seeded DOLE report");
  assert.equal(victimGet.json?.organizationId, victim.id);
  assert.ok(victimGet.json?.report?.employees?.length > 0,
    "Victim DOLE positive cannot be an invented empty report");
  const victimProfileBefore = await db.select().from(doleReportingProfiles)
    .where(eq(doleReportingProfiles.organizationId, victim.id));
  const victimSubmissionBefore = await db.select().from(doleComplianceSubmissions)
    .where(eq(doleComplianceSubmissions.organizationId, victim.id));

  const loanSeed = [];
  for (const idx of [0, 1, 2]) {
    const org = f.orgs[idx], person = idx === 0 ? f.victimEmployee : f.ownedEmployees[idx - 1];
    const [loan] = await db.insert(employeeLoans).values({
      organizationId: org.id, employeeId: person.id,
      loanType: "SSS Salary Loan", referenceNo: "FICTIONAL-SSS-" + org.id,
      principal: "1000.00", monthlyAmortization: "100.00",
      cutoffDeduction: "50.00", remainingBalance: "900.00",
      status: "active",
    }).returning();
    const [batch] = await db.insert(governmentLoanRemittanceBatches).values({
      organizationId: org.id, legalEntityId: f.entities[idx].id,
      agency: "SSS", applicableMonth: "2025-08",
      dueDate: "2025-09-15", status: "paid",
      employeeCount: 1, loanCount: 1, expectedTotal: "50.00",
      amountPaid: "50.00", snapshotHash: "a".repeat(64),
      createdBy: "Fictional disposable compliance QA",
    }).returning();
    const [member] = await db.insert(governmentLoanRemittanceMembers).values({
      batchId: batch.id, organizationId: org.id,
      legalEntityId: f.entities[idx].id, loanId: loan.id,
      employeeId: person.id, employeeNo: person.employeeNo,
      loanType: loan.loanType, loanReferenceNo: loan.referenceNo,
      deductedAmount: "50.00", postingStatus: "pending",
    }).returning();
    loanSeed.push({ batch, member });
  }
  const victimLoansBefore = await db.select().from(governmentLoanRemittanceBatches)
    .where(eq(governmentLoanRemittanceBatches.organizationId, victim.id));
  const victimMembersBefore = await db.select().from(governmentLoanRemittanceMembers)
    .where(eq(governmentLoanRemittanceMembers.organizationId, victim.id));

  for (const idx of [1, 2]) {
    const own = f.orgs[idx], cookie = f.ownerSessions[idx].cookie;
    const saved = expectStatus(await request("/api/compliance/dole-13th-month", {
      method: "POST", cookie,
      body: { organizationId: own.id, taxYear: year, action: "save_profile",
        establishmentAddress: "Fictional test-only establishment address",
        principalBusiness: "CI synthetic verification",
        contactName: "Fictional tester",
        contactPosition: "Payroll QA",
        contactPhone: "0000000000" },
    }), 200, "Authorized employer saves its own fictional DOLE profile");
    assert.equal(saved.json?.profile?.organizationId, own.id);
    const ownDole = expectStatus(await request(
      "/api/compliance/dole-13th-month?organizationId=" + own.id +
      "&taxYear=" + year, { cookie }), 200,
      "Actual owned 13th-month report must load");
    assert.equal(ownDole.json?.organizationId, own.id);
    assert.equal(ownDole.json?.taxYear, year);
    assert.equal(ownDole.json?.profileComplete, true);
    assert.ok(ownDole.json?.report?.employees?.length > 0,
      "Positive DOLE GET needs real seeded released payroll employees");
    expectStatus(await request(
      "/api/compliance/dole-13th-month?organizationId=" + victim.id +
      "&taxYear=" + year, { cookie }), 403,
      "Unrelated employer cannot read real victim DOLE report");
    expectStatus(await request("/api/compliance/dole-13th-month", {
      method: "POST", cookie,
      body: { organizationId: victim.id, taxYear: year, action: "save_profile",
        establishmentAddress: "Forged victim profile", principalBusiness: "Forged",
        contactName: "Not authorized", contactPosition: "Intruder",
        contactPhone: "0000000000" },
    }), 403, "Foreign DOLE POST must deny without altering profile");

    const ownLoanRead = expectStatus(await request(
      "/api/compliance/government-loan-remittances?organizationId=" + own.id +
      "&legalEntityId=" + f.entities[idx].id, { cookie }), 200,
      "Authorized employer reads its real synthetic SSS loan batch");
    assert.equal(ownLoanRead.json?.organizationId, own.id);
    assert.ok(ownLoanRead.json?.batches?.some(x => x.id === loanSeed[idx].batch.id));
    assert.ok(ownLoanRead.json?.members?.some(x => x.id === loanSeed[idx].member.id));
    expectStatus(await request(
      "/api/compliance/government-loan-remittances?organizationId=" + victim.id +
      "&legalEntityId=" + f.entities[0].id, { cookie }), 403,
      "Foreign employer cannot read victim loan remittance batch");
    const ownException = expectStatus(await request(
      "/api/compliance/government-loan-remittances", {
        method: "POST", cookie,
        body: { organizationId: own.id, legalEntityId: f.entities[idx].id,
          action: "mark_member_exception", memberId: loanSeed[idx].member.id,
          exceptionNote: "Fictional agency posting discrepancy, no money moved" },
      }), 200, "Owned synthetic loan posting exception is recorded");
    assert.equal(ownException.json?.member?.id, loanSeed[idx].member.id);
    assert.equal(ownException.json?.member?.organizationId, own.id);
    expectStatus(await request("/api/compliance/government-loan-remittances", {
      method: "POST", cookie,
      body: { organizationId: victim.id, legalEntityId: f.entities[0].id,
        action: "mark_member_exception", memberId: loanSeed[0].member.id,
        exceptionNote: "Forged other-employer posting exception" },
    }), 403, "Foreign loan POST must deny a real victim member");
  }

  const victimProfileAfter = await db.select().from(doleReportingProfiles)
    .where(eq(doleReportingProfiles.organizationId, victim.id));
  const victimSubmissionAfter = await db.select().from(doleComplianceSubmissions)
    .where(eq(doleComplianceSubmissions.organizationId, victim.id));
  assert.deepEqual(victimProfileAfter, victimProfileBefore,
    "Forged DOLE profile POST did not alter real victim employer profile");
  assert.deepEqual(victimSubmissionAfter, victimSubmissionBefore,
    "DOLE submission audit proof for victim employer is unchanged");
  const victimLoansAfter = await db.select().from(governmentLoanRemittanceBatches)
    .where(eq(governmentLoanRemittanceBatches.organizationId, victim.id));
  const victimMembersAfter = await db.select().from(governmentLoanRemittanceMembers)
    .where(eq(governmentLoanRemittanceMembers.organizationId, victim.id));
  assert.deepEqual(victimLoansAfter, victimLoansBefore,
    "Denied loan POST must not change victim batch balances or status");
  assert.deepEqual(victimMembersAfter, victimMembersBefore,
    "Denied loan POST must not change victim posting evidence");
}

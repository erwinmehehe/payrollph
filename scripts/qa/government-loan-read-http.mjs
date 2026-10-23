/**
 * Three real tenant sessions + fictional PG16 batch/member evidence.
 * No provider calls, payment instructions or production database permitted.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  employeeLoans, governmentLoanRemittanceBatches, governmentLoanRemittanceMembers,
} from "../../src/db/schema";

export async function verifyGovernmentLoanRemittanceIsolation(f, { request, expectStatus }) {
  if (process.env.CI !== "true" ||
      process.env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      !/^(postgresql:\/\/)([^/]+@)(127\.0\.0\.1|localhost):5432\/app_db$/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Government loan isolation requires disposable PostgreSQL.");
  }
  const loans = await db.insert(employeeLoans).values(f.orgs.map((org,idx) => ({
    organizationId:org.id,
    employeeId:idx === 0 ? f.victimEmployee.id : f.ownedEmployees[idx-1].id,
    loanType:"SSS Salary Loan",referenceNo:"QA-SYNTHETIC-"+org.id,
    principal:"500.00",monthlyAmortization:"125.00",
    cutoffDeduction:"62.50",remainingBalance:"375.00",
  }))).returning({id:employeeLoans.id});
  const batches = await db.insert(governmentLoanRemittanceBatches).values(f.orgs.map((org,idx) => ({
    organizationId:org.id,legalEntityId:f.entities[idx].id,
    agency:"SSS",applicableMonth:"2026-08",dueDate:"2026-09-30",
    status:"paid",employeeCount:1,loanCount:1,expectedTotal:"125.00",
    amountPaid:"125.00",paymentReference:"FICTIONAL-PAID-"+idx,paidAt:new Date("2026-09-30T00:00:00.000Z"),
    agencyAcknowledgementReference:"FICTIONAL-ACK-"+idx,
    snapshotHash:"a".repeat(64),createdBy:"Fictional CI",
  }))).returning({id:governmentLoanRemittanceBatches.id});
  const members = await db.insert(governmentLoanRemittanceMembers).values(f.orgs.map((org,idx) => ({
    batchId:batches[idx].id,organizationId:org.id,
    legalEntityId:f.entities[idx].id,
    loanId:loans[idx].id,
    employeeId:idx === 0 ? f.victimEmployee.id : f.ownedEmployees[idx-1].id,
    employeeNo:idx === 0 ? f.victimEmployee.employeeNo : "QA-OWN-"+idx,
    loanType:"SSS Salary Loan",loanReferenceNo:"QA-SYNTHETIC-"+org.id,
    deductedAmount:"125.00",postingStatus:"pending",
  }))).returning({id:governmentLoanRemittanceMembers.id});
  const victim = f.orgs[0];
  const beforeBatches = await db.select().from(governmentLoanRemittanceBatches)
    .where(eq(governmentLoanRemittanceBatches.organizationId,victim.id));
  const beforeMembers = await db.select().from(governmentLoanRemittanceMembers)
    .where(eq(governmentLoanRemittanceMembers.organizationId,victim.id));
  for (const idx of [1,2]) {
    const org = f.orgs[idx], cookie = f.ownerSessions[idx].cookie;
    const ownLoanRead = expectStatus(await request("/api/compliance/government-loan-remittances?organizationId=" +
      org.id + "&legalEntityId=" + f.entities[idx].id, {cookie}), 200,
      "Owned remittance batch and member must be readable");
    assert.equal(ownLoanRead.json?.organizationId,org.id);
    assert.equal(ownLoanRead.json?.legalEntityId,f.entities[idx].id);
    assert.ok(ownLoanRead.json?.batches?.some(b=>b.id===batches[idx].id));
    assert.ok(ownLoanRead.json?.members?.some(m=>m.id===members[idx].id));
    assert.ok(!ownLoanRead.json?.members?.some(m=>m.id===members[0].id)); assert.ok((await import("../../src/lib/government-loan-remittance-read")).isVerifiedGovernmentLoanRemittanceRead(ownLoanRead.json,org.id),"Existing main loan proof fixture must satisfy the merged strict client validator");
    expectStatus(await request("/api/compliance/government-loan-remittances?organizationId=" +
      victim.id + "&legalEntityId=" + f.entities[0].id, {cookie}), 403,
      "Foreign government loan reconciliation GET must deny victim data");
    const ownLoanPost = expectStatus(await request("/api/compliance/government-loan-remittances", {
      method:"POST",cookie,
      body:{organizationId:org.id,legalEntityId:f.entities[idx].id,
        action:"mark_member_exception",memberId:members[idx].id,
        exceptionNote:"Synthetic case requires manual agency reconciliation"},
    }), 200, "Owned synthetic loan exception POST succeeds");
    assert.equal(ownLoanPost.json?.member?.organizationId,org.id);
    assert.equal(ownLoanPost.json?.member?.postingStatus,"exception");
    expectStatus(await request("/api/compliance/government-loan-remittances", {
      method:"POST",cookie,
      body:{organizationId:victim.id,legalEntityId:f.entities[0].id,
        action:"mark_member_exception",memberId:members[0].id,
        exceptionNote:"FORGED VICTIM EXCEPTION"},
    }), 403, "Foreign government loan POST denied");
  }
  const afterBatches = await db.select().from(governmentLoanRemittanceBatches)
    .where(eq(governmentLoanRemittanceBatches.organizationId,victim.id));
  const afterMembers = await db.select().from(governmentLoanRemittanceMembers)
    .where(eq(governmentLoanRemittanceMembers.organizationId,victim.id));
  assert.deepEqual(afterBatches,beforeBatches,"Foreign POST cannot change victim agency remittance");
  assert.deepEqual(afterMembers,beforeMembers,"Foreign POST cannot change victim worker loan posting");
}

/**
 * Real disposable PostgreSQL and localhost HTTP verification of employer-scoped
 * DOLE reports and government-loan remittance reads/writes. Synthetic only:
 * no real portal acknowledgements, agency payments, filing, or money movement.
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, doleReportingProfiles, doleComplianceSubmissions, employeeLoans,
  governmentLoanRemittanceBatches, governmentLoanRemittanceMembers,
  statutoryRemittanceBatches, statutoryRemittancePaymentEvidence,
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
  await verifyBirAndPaymentProof(f, { request, expectStatus });
}

async function verifyBirAndPaymentProof(f, { request, expectStatus }) {
  const victim = f.orgs[0];
  const taxYear = 2026;
  const officialVictimAuditsBefore = await db.select().from(auditEvents)
    .where(eq(auditEvents.organizationId, victim.id));
  const storedVictimProofBefore = await db.select().from(statutoryRemittancePaymentEvidence)
    .where(eq(statutoryRemittancePaymentEvidence.organizationId, victim.id));
  const proofRows = [];
  for (let idx = 0; idx < 3; idx++) {
    const [batch] = await db.select().from(statutoryRemittanceBatches)
      .where(and(
        eq(statutoryRemittanceBatches.organizationId, f.orgs[idx].id),
        eq(statutoryRemittanceBatches.status, "open"),
      )).limit(1);
    assert.ok(batch?.id > 0, "Synthetic security smoke must have a persisted open statutory batch");
    const [stored] = await db.select().from(statutoryRemittancePaymentEvidence)
      .where(and(
        eq(statutoryRemittancePaymentEvidence.organizationId, f.orgs[idx].id),
        eq(statutoryRemittancePaymentEvidence.batchId, batch.id),
      )).limit(1);
    assert.ok(stored?.id > 0, "Own stored payment proof must be real before API test");
    proofRows.push({ batch, stored });
  }
  const testPdf = "%PDF-1.4\\nFICTIONAL PAYROLLPH TENANT SCOPE PROOF\\n%%EOF\\n";
  function proofForm(organizationId, batchId) {
    const form = new FormData();
    form.set("organizationId", String(organizationId));
    form.set("batchId", String(batchId));
    form.set("replacementReason", "Fictional replacement in disposable security acceptance, no payment");
    form.set("file", new File([testPdf], "fictional-tenant-proof.pdf", { type: "application/pdf" }));
    return form;
  }
  for (const idx of [1, 2]) {
    const own = f.orgs[idx], cookie = f.ownerSessions[idx].cookie;
    const ownModule = expectStatus(await request(
      "/api/bir/annual-employer/module-evidence?organizationId=" + own.id +
      "&legalEntityId=" + f.entities[idx].id + "&taxYear=" + taxYear,
      { cookie }), 200, "Owned BIR module evidence GET must return real source digest");
    assert.equal(ownModule.json?.organizationId, own.id);
    assert.equal(ownModule.json?.legalEntityId, f.entities[idx].id);
    assert.equal(ownModule.json?.taxYear, taxYear);
    assert.match(ownModule.json?.sourceDigest, /^[a-f0-9]{64}$/);
    expectStatus(await request(
      "/api/bir/annual-employer/module-evidence?organizationId=" + victim.id +
      "&legalEntityId=" + f.entities[0].id + "&taxYear=" + taxYear,
      { cookie }), 403, "Unrelated employer cannot view victim BIR module evidence");

    // Fake a prior *candidate download audit* only in isolated PostgreSQL.
    // This is not validator acceptance and never denotes BIR filing.
    const fileSha256 = "b".repeat(64);
    await db.insert(auditEvents).values({
      organizationId: own.id,
      actor: "Fictional independent CI fixture",
      action: "bir1604c.candidate.downloaded",
      resource: "legal-entity:" + f.entities[idx].id + ":year:" + taxYear,
      metadata: { sourceDigest: ownModule.json.sourceDigest, fileSha256 },
    });
    const observed = expectStatus(await request("/api/bir/annual-employer/module-evidence", {
      method: "POST", cookie,
      body: { organizationId: own.id, legalEntityId: f.entities[idx].id, taxYear,
        mode: "observe", moduleVersion: "7.0", fileSha256,
        sourceDigest: ownModule.json.sourceDigest, outcome: "fail",
        validatedOn: "2026-10-19",
        evidenceReference: "CI-FICTIONAL-NONFILING-VALIDATOR-LOG" },
    }), 200, "Own fictitious BIR module observation must record pending review only");
    assert.ok(observed.json?.observationId > 0);
    assert.equal(observed.json?.status, "not run");
    expectStatus(await request("/api/bir/annual-employer/module-evidence", {
      method: "POST", cookie,
      body: { organizationId: victim.id, legalEntityId: f.entities[0].id,
        taxYear, mode: "observe", moduleVersion: "7.0",
        fileSha256, sourceDigest: ownModule.json.sourceDigest,
        outcome: "pass", validatedOn: "2026-10-19",
        evidenceReference: "FORGED-VICTIM-OBSERVATION" },
    }), 403, "Foreign BIR observation must deny actual victim employer");

    const ownProof = expectStatus(await request(
      "/api/compliance/statutory-remittances/payment-evidence?organizationId=" +
      own.id + "&batchId=" + proofRows[idx].batch.id,
      { cookie }), 200, "Own synthetic payment-proof GET must show real recorded proof");
    assert.equal(ownProof.json?.organizationId, own.id);
    assert.equal(ownProof.json?.batchId, proofRows[idx].batch.id);
    assert.ok(ownProof.json?.evidence?.some(row => row.id === proofRows[idx].stored.id));
    expectStatus(await request(
      "/api/compliance/statutory-remittances/payment-evidence?organizationId=" +
      victim.id + "&batchId=" + proofRows[0].batch.id,
      { cookie }), 403, "Foreign statutory proof GET must deny real victim record");

    const newProof = expectStatus(await requestMultipart(cookie,
      proofForm(own.id, proofRows[idx].batch.id)),
      201, "Owned known synthetic PDF upload must succeed with test-only scanner");
    assert.ok(newProof.json?.evidence?.id > 0);
    const [persistedProof] = await db.select().from(statutoryRemittancePaymentEvidence)
      .where(eq(statutoryRemittancePaymentEvidence.id, newProof.json.evidence.id));
    assert.equal(persistedProof?.organizationId, own.id);
    assert.equal(persistedProof?.batchId, proofRows[idx].batch.id);
    expectStatus(await requestMultipart(cookie,
      proofForm(victim.id, proofRows[0].batch.id)),
      403, "Foreign statutory proof POST must not change actual victim batch");
  }
  const officialVictimAuditsAfter = await db.select().from(auditEvents)
    .where(eq(auditEvents.organizationId, victim.id));
  assert.deepEqual(officialVictimAuditsAfter, officialVictimAuditsBefore,
    "Denied victim BIR observation leaves all victim audit events untouched");
  const storedVictimProofAfter = await db.select().from(statutoryRemittancePaymentEvidence)
    .where(eq(statutoryRemittancePaymentEvidence.organizationId, victim.id));
  assert.deepEqual(storedVictimProofAfter, storedVictimProofBefore,
    "Denied victim payment-proof uploads leave original evidence unchanged");
}

/** Multipart transport is private to the disposable test; do not alter the
 * original request helper: other tenant proofs are pinned to its exact lines. */
async function requestMultipart(cookie, form) {
  const url = new URL("/api/compliance/statutory-remittances/payment-evidence",
    process.env.SECURITY_SMOKE_URL);
  const result = await fetch(url, {
    method: "POST",
    headers: {
      cookie,
      origin: process.env.SECURITY_SMOKE_URL,
      "sec-fetch-site": "same-origin",
    },
    body: form,
    cache: "no-store",
    redirect: "manual",
  });
  const responseText = await result.text();
  let json = null;
  try { json = JSON.parse(responseText); } catch { /* invalid JSON is failure */ }
  return { status: result.status, text: responseText, json, headers: result.headers };
}

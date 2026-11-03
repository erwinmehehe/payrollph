// Disposable-PG16 only. Synthetic upstream evidence never claims a bank, agency or BIR transaction.
// One genuine ready historical own-month certification per attacker; real higher-ID victim remains unchanged.
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  employees, payrollEntries, payrollRuns, payslips,
  statutoryRemittanceBatches as batches,
  statutoryRemittanceMembers as members,
  statutoryRemittancePaymentEvidence as paymentEvidence,
  statutoryPostingEvidenceArtifacts as postingEvidence,
  statutoryRemittanceMonthClosures as remittanceClosures,
  payrollMonthClosures as closures,
  governmentFilingValidations as filings,
  auditEvents, yearEndAdjustments,
} from "../../../../src/db/schema.ts";

export const fixtureOrder = {};
const month = "2026-05";
const plain = rows => JSON.parse(JSON.stringify(rows));
const sha = value => createHash("sha256").update(String(value)).digest("hex");
const money = value => Number(value).toFixed(2);

export function createRows({ assert, db, eq, asc, auditBusinessSnapshot }) {
  const byOrg = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const state = async orgId => {
    const runRows = await byOrg(payrollRuns, orgId);
    return {
      runs: plain(runRows),
      entries: plain(runRows.length ? await db.select().from(payrollEntries)
        .where(inArray(payrollEntries.payrollRunId, runRows.map(run => run.id)))
        .orderBy(asc(payrollEntries.id)) : []),
      payslips: plain(await byOrg(payslips, orgId)),
      batches: plain(await byOrg(batches, orgId)),
      members: plain(await byOrg(members, orgId)),
      paymentEvidence: plain(await byOrg(paymentEvidence, orgId)),
      postingEvidence: plain(await byOrg(postingEvidence, orgId)),
      remittanceClosures: plain(await byOrg(remittanceClosures, orgId)),
      filings: plain(await byOrg(filings, orgId)),
      closures: plain(await byOrg(closures, orgId)),
      adjustments: plain(await byOrg(yearEndAdjustments, orgId)),
      audit: plain(auditBusinessSnapshot(await byOrg(auditEvents, orgId))),
    };
  };
  const body = (orgId, entityId) => ({
    organizationId: orgId, legalEntityId: entityId, applicableMonth: month,
  });
  return [{
    key: "POST compliance/payroll-month-close",
    profile: "compliance-posts",
    status: 200,
    deny: 403,
    seed: async employer => {
      const [{ computeSss }, { encryptGovernmentId }, { findFilingForm },
        { loadStatutoryRemittanceState, statutoryLiabilityKeys },
        { evaluateRemittanceMonthClose }, { buildStatutoryRemittanceSnapshot }] = await Promise.all([
          import("../../../../src/lib/payroll-rules.ts"),
          import("../../../../src/lib/government-id-crypto.ts"),
          import("../../../../src/lib/filing-evidence.ts"),
          import("../../../../src/lib/statutory-remittance-state.ts"),
          import("../../../../src/lib/statutory-remittance-close.ts"),
          import("../../../../src/lib/statutory-remittance.ts"),
        ]);
      const sss = computeSss(20000);
      const total = money(sss.employee + sss.employerTotal);
      assert.ok(Number(total) > 0, "real source SSS rule must produce positive fictional liability");
      const actor = "FICTIONAL-UPSTREAM-" + employer.marker;
      const certifier = "FICTIONAL-REMITTANCE-CHECKER-" + employer.marker;
      const [worker] = await db.update(employees).set({
        legalEntityId: employer.entity.id,
        sssNo: encryptGovernmentId("1000000000", { required: true }),
      }).where(eq(employees.id, employer.worker.id)).returning();
      assert.equal(worker.legalEntityId, employer.entity.id);
      const [run] = await db.insert(payrollRuns).values({
        organizationId: employer.org.id, legalEntityId: employer.entity.id,
        periodLabel: "FICTIONAL READY MONTH " + employer.marker,
        periodStart: "2026-05-01", periodEnd: "2026-05-31", payDate: "2026-05-31",
        status: "Released", employeeCount: 1,
        grossPay: "20000.00", netPay: money(20000 - sss.employee),
      }).returning();
      const [entry] = await db.insert(payrollEntries).values({
        payrollRunId: run.id, employeeId: worker.id,
        grossPay: "20000.00", deductions: money(sss.employee),
        netPay: money(20000 - sss.employee), status: "Ready",
        lineItems: [{ code: "SSS", label: "Fictional SSS", amount: -sss.employee }],
        trace: { inputs: [
          "sssEmployerCutoff=" + sss.employerTotal,
          "sssEmployerEcCutoff=0",
        ], punches: 22, fictional: true, marker: employer.marker },
      }).returning();
      await db.insert(payslips).values({
        payrollEntryId: entry.id, organizationId: employer.org.id,
        employeeId: worker.id, periodLabel: run.periodLabel,
        content: "FICTIONAL PG16 SECURITY PROOF ONLY: no salary, bank or agency transfer.",
      });
      const sourceSnapshot = buildStatutoryRemittanceSnapshot({
        agency: "SSS", applicableMonth: month,
        entries: [{ employeeId: worker.id, grossPay: entry.grossPay,
          lineItems: entry.lineItems, trace: entry.trace }],
        employees: [{ id: worker.id, employeeNo: worker.employeeNo }],
      });
      assert.equal(money(sourceSnapshot.expectedTotal), total,
        "fictional reconciled batch must match source-computed liability");
      const [batch] = await db.insert(batches).values({
        organizationId: employer.org.id, legalEntityId: employer.entity.id,
        agency: "SSS", applicableMonth: month, dueDate: "2026-06-30",
        status: "reconciled", employeeCount: 1,
        expectedEmployeeShare: money(sourceSnapshot.expectedEmployeeShare),
        expectedEmployerShare: money(sourceSnapshot.expectedEmployerShare),
        expectedTotal: money(sourceSnapshot.expectedTotal), amountPaid: total,
        paymentReference: "FICTIONAL-NO-BANK-PAYMENT-" + employer.marker,
        agencyReceiptReference: "FICTIONAL-NO-AGENCY-RECEIPT-" + employer.marker,
        paidAt: new Date("2026-06-10T12:00:00Z"), paymentRecordedBy: actor,
        reconciledAt: new Date("2026-06-15T12:00:00Z"), reconciledBy: actor,
        snapshotHash: sourceSnapshot.snapshotHash,
        createdBy: actor,
      }).returning();
      const [artifact] = await db.insert(postingEvidence).values({
        organizationId: employer.org.id, batchId: batch.id,
        sourceType: "manual_confirmation", outcome: "manual_confirmed",
        contentSha256: sha("FICTIONAL POSTING " + employer.marker),
        evidenceReference: "FICTIONAL-NO-POSTING-" + employer.marker,
        rowCount: 1, recordedByName: actor,
      }).returning();
      await db.insert(members).values({
        batchId: batch.id, organizationId: employer.org.id,
        legalEntityId: employer.entity.id, employeeId: worker.id,
        employeeNo: worker.employeeNo, employeeShare: money(sourceSnapshot.members[0].employeeShare),
        employerShare: money(sourceSnapshot.members[0].employerShare),
        totalContribution: money(sourceSnapshot.members[0].totalContribution),
        postingStatus: "confirmed", postedAmount: total,
        postingReference: "FICTIONAL-NO-POSTING-" + employer.marker,
        postedAt: new Date("2026-06-15T12:00:00Z"), confirmedBy: actor,
        postingEvidenceArtifactId: artifact.id,
      });
      const bytes = Buffer.from("FICTIONAL NO-PAYMENT PROOF: " + employer.marker);
      await db.insert(paymentEvidence).values({
        organizationId: employer.org.id, batchId: batch.id,
        fileName: "fictional-payment-only-" + employer.marker + ".txt",
        mimeType: "text/plain", byteSize: bytes.length,
        fileSha256: sha(bytes.toString("utf8")),
        fileDataBase64: bytes.toString("base64"), status: "active",
        uploadedByName: actor,
      });
      const bir = findFilingForm("BIR", "1601-C");
      assert.ok(bir && bir.evidenceMode === "operational");
      await db.insert(filings).values({
        organizationId: employer.org.id, legalEntityId: employer.entity.id,
        payrollRunId: run.id, agency: "BIR", form: "1601-C",
        periodLabel: run.periodLabel, applicableMonth: month,
        fileName: "FICTIONAL-NOT-FILED-" + employer.marker + ".csv",
        fileSha256: sha("FICTIONAL NO BIR FILING " + employer.marker),
        generatorVersion: bir.generatorVersion, status: "accepted",
        submissionMethod: "manual_entry",
        agencyReference: "FICTIONAL-NO-BIR-ACK-" + employer.marker,
        submittedAt: new Date("2026-06-15T12:00:00Z"),
        generatedBy: actor, recordedBy: actor,
        recordedAt: new Date("2026-06-15T12:00:00Z"),
        outcomeNote: "DISPOSABLE-FICTIONAL: never filed with BIR",
      });
      for (const action of [
        "Payroll payout completed manually", "journal export generated", "Payroll close completed",
      ]) {
        await db.insert(auditEvents).values({
          organizationId: employer.org.id, actor, action,
          resource: "FICTIONAL payroll " + run.id,
          metadata: {
            runId: run.id, fictional: true, noFundsMoved: true,
            reference: "FICTIONAL-NO-TRANSFER-" + employer.marker,
            method: "test-fixture-only",
            completedAt: "2026-06-15T12:00:00Z",
          },
        });
      }
      const remittanceState = await loadStatutoryRemittanceState(employer.org.id, employer.entity.id);
      assert.ok(remittanceState);
      const keys = [...statutoryLiabilityKeys({
        runMonths: { [run.id]: month },
        entries: [{
          payrollRunId: run.id, employeeId: worker.id,
          lineItems: entry.lineItems, trace: entry.trace,
        }],
      })].map(key => key.split("|")[1]);
      assert.deepEqual(keys, ["SSS"], "real payroll evidence must require SSS for the historical month");
      const activeEvidence = await db.select({
        id: paymentEvidence.id, batchId: paymentEvidence.batchId,
        fileName: paymentEvidence.fileName, fileSha256: paymentEvidence.fileSha256,
        byteSize: paymentEvidence.byteSize, status: paymentEvidence.status,
        uploadedByUserId: paymentEvidence.uploadedByUserId,
        uploadedByName: paymentEvidence.uploadedByName,
        uploadedAt: paymentEvidence.uploadedAt,
      }).from(paymentEvidence).where(eq(paymentEvidence.batchId, batch.id));
      const evaluated = evaluateRemittanceMonthClose({
        applicableMonth: month,
        batches: remittanceState.batches,
        members: remittanceState.members,
        alerts: remittanceState.alerts,
        corrections: [], paymentEvidence: activeEvidence,
        issueCases: [], requiredAgencies: keys,
        allPayrollRunsReleased: true,
      });
      assert.equal(evaluated.ready, true, "real evaluated fictional remittance readiness: " + evaluated.blockers.join("; "));
      const [certification] = await db.insert(remittanceClosures).values({
        organizationId: employer.org.id, legalEntityId: employer.entity.id,
        applicableMonth: month, status: "certified",
        snapshotHash: evaluated.snapshotHash, certifiedByName: certifier,
        certifiedAt: new Date("2026-06-16T00:00:00Z"),
      }).returning();
      return { runId: run.id, batchId: batch.id,
        remittanceClosureId: certification.id, month };
    },
    state,
    ownBody: c => body(c.orgId, c.entityId),
    foreignBody: c => body(c.victim.org.id, c.victim.entity.id),
    forged: { status: 409, body: c => body(c.orgId, c.victim.entity.id) },
    expect: (before, after, c, response) => {
      assert.equal(response.json?.certificationValid, true);
      assert.equal(response.json?.evaluation?.ready, true);
      assert.equal(response.json?.evaluation?.runCount, 1);
      assert.equal(after.closures.length, before.closures.length + 1);
      const closure = after.closures.at(-1);
      assert.equal(closure.id, response.json?.closure?.id);
      assert.equal(closure.organizationId, c.orgId);
      assert.equal(closure.legalEntityId, c.entityId);
      assert.equal(closure.applicableMonth, month);
      assert.equal(closure.status, "certified");
      assert.match(closure.snapshotHash, /^[0-9a-f]{64}$/);
      assert.equal(closure.evidenceSnapshot?.runs?.[0]?.id, c.seeded.runId);
      assert.equal(closure.evidenceSnapshot?.bir1601c?.proven, true);
      assert.equal(closure.evidenceSnapshot?.remittance?.certificationValid, true);
      assert.equal(closure.evidenceSnapshot?.inspection?.highFindingCount, 0);
      assert.equal(after.audit.length, before.audit.length + 1);
      assert.equal(after.audit.at(-1)?.action, "Payroll month close certified");
      assert.equal(after.audit.at(-1)?.organizationId, c.orgId);
      for (const table of ["runs", "entries", "payslips", "batches", "members",
        "paymentEvidence", "postingEvidence", "remittanceClosures", "filings", "adjustments"]) {
        assert.deepEqual(after[table], before[table], "month certification cannot mutate " + table);
      }
    },
    exercise: async (c, { request, expectStatus, cookie }) => {
      const url = "/api/compliance/payroll-month-close";
      const query = new URLSearchParams({
        organizationId: String(c.orgId), legalEntityId: String(c.entityId),
        applicableMonth: month,
      });
      const owned = expectStatus(await request(url + "?" + query, { cookie }),
        200, "genuine own certified historical month GET");
      assert.equal(owned.json?.certificationValid, true);
      assert.equal(owned.json?.runEvidence?.length, 1);
      const victimState = await state(c.victim.org.id);
      const denied = expectStatus(await request(url + "?" + new URLSearchParams({
        organizationId: String(c.victim.org.id),
        legalEntityId: String(c.victim.entity.id),
        applicableMonth: month,
      }), { cookie }), 403, "real higher-ID victim employer monthly read denied");
      assert.ok(!denied.text.includes(c.victim.marker));
      const forged = expectStatus(await request(url + "?" + new URLSearchParams({
        organizationId: String(c.orgId),
        legalEntityId: String(c.victim.entity.id),
        applicableMonth: month,
      }), { cookie }), 409, "genuine foreign legal employer forged on monthly read");
      assert.ok(!forged.text.includes(c.victim.marker));
      assert.deepEqual(await state(c.victim.org.id), victimState,
        "victim SQL and business audit unchanged after both additional reads");
      return {
        realReadyCertifiedMonth: true,
        ownMonthClose200: 1, ownMonthRead200: 1,
        realVictimWrite403: 1, realVictimRead403: 1,
        forgedRealLegalEntityWrite409: 1, forgedRealLegalEntityRead409: 1,
        victimDatabaseUnchanged: true, independentFictionalCertifier: true,
        externalPaymentOrAgencyCalls: 0, exactMethodCredits: 0,
      };
    },
  }];
}

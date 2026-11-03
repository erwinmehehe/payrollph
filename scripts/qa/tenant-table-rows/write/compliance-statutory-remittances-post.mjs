// Synthetic-only statutory remittance reconciliation actions. No money or provider calls.
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  employees, payrollEntries, payrollRuns,
  statutoryRemittanceBatches as batches,
  statutoryRemittanceMembers as members,
  statutoryRemittancePaymentEvidence as paymentEvidence,
  statutoryPostingEvidenceArtifacts as postingEvidence,
  statutoryRemittanceMonthClosures as monthClosures,
  yearEndAdjustments, auditEvents,
} from "../../../../src/db/schema.ts";

export const fixtureOrder = {};

const plain = rows => JSON.parse(JSON.stringify(rows));
const hash = value => createHash("sha256").update(String(value)).digest("hex");
const month = ["2026-09", "2026-08"];
const money = number => Number(number).toFixed(2);

export function createRows({ assert, db, eq, asc, auditBusinessSnapshot }) {
  const byOrg = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const state = async orgId => {
    const runs = await byOrg(payrollRuns, orgId);
    const entries = runs.length ? await db.select().from(payrollEntries)
      .where(inArray(payrollEntries.payrollRunId, runs.map(run => run.id)))
      .orderBy(asc(payrollEntries.id)) : [];
    return {
      employees: plain(await byOrg(employees, orgId)),
      runs: plain(runs), entries: plain(entries),
      batches: plain(await byOrg(batches, orgId)),
      members: plain(await byOrg(members, orgId)),
      paymentEvidence: plain(await byOrg(paymentEvidence, orgId)),
      postingEvidence: plain(await byOrg(postingEvidence, orgId)),
      closures: plain(await byOrg(monthClosures, orgId)),
      adjustments: plain(await byOrg(yearEndAdjustments, orgId)),
      audit: plain(auditBusinessSnapshot(await byOrg(auditEvents, orgId))),
    };
  };
  const createBody = (orgId, entityId, applicableMonth) => ({
    organizationId: orgId, legalEntityId: entityId,
    action: "create_batch", agency: "SSS", applicableMonth,
  });
  const ownBody = c => createBody(c.orgId, c.entityId, month[0]);
  const foreignBody = c => createBody(c.victim.org.id, c.victim.entity.id, month[0]);
  const forgedBody = c => ({
    organizationId: c.orgId, legalEntityId: c.entityId,
    action: "record_payment", batchId: c.victimSeeded.id,
    amountPaid: c.victimSeeded.total,
    paymentReference: "FICTIONAL-FOREIGN-PAYMENT",
    agencyReceiptReference: "FICTIONAL-FOREIGN-RECEIPT",
  });
  const insertSyntheticReceipt = async (actor, batch) => {
    const bytes = Buffer.from("FICTIONAL TEST RECEIPT ONLY; no payment, agency or bank acknowledgement: " +
      actor.marker + " / " + batch.id, "utf8");
    const [evidence] = await db.insert(paymentEvidence).values({
      organizationId: actor.org.id, batchId: batch.id,
      fileName: "fictional-no-agency-receipt-" + actor.marker + ".txt",
      mimeType: "text/plain", byteSize: bytes.byteLength,
      fileSha256: createHash("sha256").update(bytes).digest("hex"),
      fileDataBase64: bytes.toString("base64"), status: "active",
      uploadedByUserId: actor.owner.id, uploadedByName: actor.owner.name,
    }).returning();
    assert.equal(evidence.organizationId, actor.org.id);
    return evidence;
  };
  const ownBatch = (snapshot, orgId, m) => {
    const rows = snapshot.batches.filter(item => item.organizationId === orgId &&
      item.agency === "SSS" && item.applicableMonth === m);
    assert.equal(rows.length, 1, "one actual batch per source employer, agency and month");
    return rows[0];
  };
  return [{
    key: "POST compliance/statutory-remittances",
    profile: "compliance-posts",
    status: 201,
    deny: 403,
    seed: async employer => {
      const [{ encryptGovernmentId }, { computeSss }] = await Promise.all([
        import("../../../../src/lib/government-id-crypto.ts"),
        import("../../../../src/lib/payroll-rules.ts"),
      ]);
      const salary = 20000;
      const rule = computeSss(salary);
      assert.ok(rule.employee > 0 && rule.employerTotal > 0,
        "fictional positive SSS liability must be computed from actual repository rules");
      const total = money(rule.employee + rule.employerTotal);
      const encrypted = encryptGovernmentId("1000000000", { required: true });
      const [worker] = await db.update(employees).set({
        legalEntityId: employer.entity.id, sssNo: encrypted,
      }).where(eq(employees.id, employer.worker.id)).returning();
      assert.equal(worker.legalEntityId, employer.entity.id);
      assert.match(worker.sssNo, /^enc:/);
      for (const applicableMonth of month) {
        const [year, m] = applicableMonth.split("-");
        const last = new Date(Date.UTC(Number(year), Number(m), 0)).toISOString().slice(0, 10);
        const [run] = await db.insert(payrollRuns).values({
          organizationId: employer.org.id, legalEntityId: employer.entity.id,
          periodLabel: "FICTIONAL SSS " + applicableMonth + " " + employer.marker,
          periodStart: applicableMonth + "-01", periodEnd: last,
          payDate: last, status: "Released", employeeCount: 1,
          grossPay: money(salary), netPay: money(salary - rule.employee),
        }).returning();
        const [entry] = await db.insert(payrollEntries).values({
          payrollRunId: run.id, employeeId: employer.worker.id,
          grossPay: money(salary), deductions: money(rule.employee),
          netPay: money(salary - rule.employee), status: "Ready",
          lineItems: [{ code: "SSS", label: "FICTIONAL SSS deduction", amount: -rule.employee }],
          trace: { inputs: [
            "sssEmployerCutoff=" + rule.employerTotal,
            "sssEmployerEcCutoff=0",
          ], fictional: true, marker: employer.marker },
        }).returning();
        assert.equal(entry.employeeId, employer.worker.id);
      }
      // A distinct real, persisted July batch/member is the forged victim
      // selector, not a guessed ID or the later positive HTTP batch.
      const [fixture] = await db.insert(batches).values({
        organizationId: employer.org.id, legalEntityId: employer.entity.id,
        agency: "SSS", applicableMonth: "2026-07", dueDate: "2026-08-31",
        status: "paid", employeeCount: 1,
        expectedEmployeeShare: money(rule.employee),
        expectedEmployerShare: money(rule.employerTotal),
        expectedTotal: total, amountPaid: total,
        snapshotHash: hash("FICTIONAL victim-selector fixture " + employer.marker),
        createdBy: employer.owner.name,
      }).returning();
      const [member] = await db.insert(members).values({
        batchId: fixture.id, organizationId: employer.org.id,
        legalEntityId: employer.entity.id, employeeId: employer.worker.id,
        employeeNo: employer.worker.employeeNo,
        employeeShare: money(rule.employee),
        employerShare: money(rule.employerTotal),
        totalContribution: total, postingStatus: "pending",
      }).returning();
      assert.equal(member.batchId, fixture.id);
      return { id: fixture.id, memberId: member.id, total };
    },
    state, ownBody, foreignBody,
    forged: { status: 404, body: forgedBody },
    expect: (before, after, c, response) => {
      assert.equal(response.json?.batch?.organizationId, c.orgId);
      assert.equal(response.json?.batch?.legalEntityId, c.entityId);
      assert.equal(response.json?.batch?.status, "open");
      const batch = ownBatch(after, c.orgId, month[0]);
      assert.equal(batch.id, response.json?.batch?.id);
      assert.ok(Number(batch.expectedTotal) > 0);
      assert.equal(after.batches.length, before.batches.length + 1);
      assert.equal(after.members.length, before.members.length + 1);
      const member = after.members.find(item => item.batchId === batch.id);
      assert.equal(member.employeeId, c.workerId);
      assert.equal(member.legalEntityId, c.entityId);
      assert.equal(member.postingStatus, "pending");
      assert.equal(after.audit.length, before.audit.length + 1);
      assert.equal(after.audit.at(-1).action, "Statutory remittance liability snapshotted");
      for (const table of ["employees", "runs", "entries", "paymentEvidence",
        "postingEvidence", "closures", "adjustments"]) {
        assert.deepEqual(after[table], before[table], "creating batch cannot mutate " + table);
      }
    },
    exercise: async (c, { request, expectStatus, cookie }) => {
      const path = "/api/compliance/statutory-remittances";
      const ownState = () => state(c.orgId);
      const victimState = () => state(c.victim.org.id);
      const victimBaseline = await victimState();
      let own = await ownState();
      let legitimateActions = 1, victimDenials = 1, forgedDenials = 1;
      const refusal = async (action, body, victimBody, forged, forgedStatus) => {
        const ownBefore = await ownState();
        const victimBefore = await victimState();
        const v = expectStatus(await request(path, { method: "POST", cookie,
          body: victimBody }), 403, action + ": actual allowlisted higher-ID victim employer denied");
        assert.ok(!v.text.includes(c.victim.marker));
        assert.deepEqual(await victimState(), victimBefore, action + ": real victim SQL changed after denial");
        assert.deepEqual(await ownState(), ownBefore, action + ": attacker's own SQL changed after denial");
        victimDenials++;
        const f = expectStatus(await request(path, { method: "POST", cookie,
          body: forged }), forgedStatus, action + ": actual victim resource ID forged under own org");
        assert.ok(!f.text.includes(c.victim.marker));
        assert.deepEqual(await victimState(), victimBefore, action + ": victim SQL changed after forged selector");
        assert.deepEqual(await ownState(), ownBefore, action + ": attacker's own SQL changed after forged selector");
        forgedDenials++;
      };
      for (const applicableMonth of month) {
        // September create was tested by shared own/foreign/forged runner.
        if (applicableMonth === month[1]) {
          const before = await ownState();
          const res = expectStatus(await request(path, { method: "POST", cookie,
            body: createBody(c.orgId, c.entityId, applicableMonth) }), 201,
            "real owned August batch from independently released synthetic payroll");
          own = await ownState();
          const batch = ownBatch(own, c.orgId, applicableMonth);
          assert.equal(res.json?.batch?.id, batch.id);
          assert.equal(own.batches.length, before.batches.length + 1);
          assert.equal(own.members.length, before.members.length + 1);
          assert.equal(own.audit.length, before.audit.length + 1);
          legitimateActions++;
          await refusal("create_batch August", null,
            createBody(c.victim.org.id, c.victim.entity.id, applicableMonth),
            createBody(c.orgId, c.victim.entity.id, applicableMonth), 409);
        }
        const batch = ownBatch(own, c.orgId, applicableMonth);
        const member = own.members.find(item => item.batchId === batch.id);
        assert.ok(member && member.organizationId === c.orgId);
        const proof = await insertSyntheticReceipt(c, batch);
        assert.equal(proof.batchId, batch.id);
        const payment = {
          organizationId: c.orgId, legalEntityId: c.entityId, action: "record_payment",
          batchId: batch.id, amountPaid: Number(batch.expectedTotal),
          paymentReference: "FICTIONAL-LOCAL-PAYMENT-" + c.marker,
          agencyReceiptReference: "FICTIONAL-LOCAL-NO-AGENCY-RECEIPT-" + c.marker,
          paymentChannel: "fictional-only", paidAt: "2026-10-15T12:00:00Z",
        };
        const paymentBefore = await ownState();
        const paid = expectStatus(await request(path, { method: "POST", cookie, body: payment }),
          200, "owned record_payment requires stored synthetic proof and creates a real audit");
        own = await ownState();
        const updatedBatch = ownBatch(own, c.orgId, applicableMonth);
        assert.equal(paid.json?.batch?.id, batch.id);
        assert.equal(updatedBatch.status, "paid");
        assert.equal(updatedBatch.amountPaid, money(batch.expectedTotal));
        assert.equal(own.audit.length, paymentBefore.audit.length + 1);
        assert.equal(own.audit.at(-1).action, "Statutory remittance payment recorded");
        legitimateActions++;
        await refusal("record_payment " + applicableMonth, null,
          { ...payment, organizationId: c.victim.org.id,
            legalEntityId: c.victim.entity.id, batchId: c.victimSeeded.id,
            amountPaid: Number(c.victimSeeded.total) },
          { ...payment, batchId: c.victimSeeded.id }, 404);
        const action = applicableMonth === month[0]
          ? "confirm_member_posting" : "mark_member_exception";
        const posting = {
          organizationId: c.orgId, legalEntityId: c.entityId, action,
          memberId: member.id,
          ...(action === "confirm_member_posting"
            ? { postedAmount: Number(member.totalContribution),
                postedAt: "2026-10-16T10:00:00Z",
                postingReference: "FICTIONAL-LOCAL-POSTING-" + c.marker }
            : { exceptionNote: "FICTIONAL agency posting exception, no real member or funds" }),
        };
        const beforePosting = await ownState();
        const posted = expectStatus(await request(path, { method: "POST", cookie, body: posting }),
          200, "real own " + action + " must persist member and batch outcome");
        own = await ownState();
        assert.equal(posted.json?.member?.id, member.id);
        const memberAfter = own.members.find(item => item.id === member.id);
        assert.equal(memberAfter.postingStatus,
          action === "confirm_member_posting" ? "confirmed" : "exception");
        const afterBatch = ownBatch(own, c.orgId, applicableMonth);
        assert.equal(afterBatch.status,
          action === "confirm_member_posting" ? "reconciled" : "exception");
        assert.equal(own.audit.length, beforePosting.audit.length + 1);
        assert.equal(own.audit.at(-1).action,
          action === "confirm_member_posting"
            ? "Employee statutory contribution posting confirmed"
            : "Statutory contribution posting exception recorded");
        if (action === "confirm_member_posting") {
          assert.equal(own.postingEvidence.length, beforePosting.postingEvidence.length + 1);
          assert.ok(memberAfter.postingEvidenceArtifactId > 0);
        }
        legitimateActions++;
        await refusal(action + " " + applicableMonth, null,
          { ...posting, organizationId: c.victim.org.id,
            legalEntityId: c.victim.entity.id, memberId: c.victimSeeded.memberId },
          { ...posting, memberId: c.victimSeeded.memberId }, 404);
      }
      assert.deepEqual(await victimState(), victimBaseline,
        "all four statutory POST actions must leave actual victim rows and business audit unchanged");
      assert.equal(legitimateActions, 6, "both batch/payment paths and two posting outcomes must run");
      assert.equal(victimDenials, 6);
      assert.equal(forgedDenials, 6);
      return { ownActionPositives: legitimateActions, realVictimDenied: victimDenials,
        realForgedVictimResourceRejected: forgedDenials,
        unchangedVictimSqlAndAudit: true, exactMethodCredit: 0,
        note: "Synthetic evidence does not prove actual agency payment or submission" };
    },
  }];
}

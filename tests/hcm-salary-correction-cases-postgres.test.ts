import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
const enabled = (() => { try { const u = new URL(process.env.DATABASE_URL ?? ""); return process.env.CI === "true" && process.env.SALARY_CORRECTION_CASES_POSTGRES_QA === "true" && ["127.0.0.1", "localhost"].includes(u.hostname) && u.pathname === "/app_db"; } catch { return false; } })();

// Fixed clock: October 2026 in Manila. Fictional employer, workers and payroll only.
const NOW = new Date("2026-10-21T04:00:00Z");

test("disposable PostgreSQL: #641 correction case completeness, reconciliation, maker-checker, tenant and rollback", { skip: !enabled }, async () => {
  const { db, pool } = await import("../src/db");
  const s = await import("../src/db/schema");
  const cases = await import("../src/lib/hcm-salary-correction-cases");
  const { payrollSourceFingerprint } = await import("../src/lib/payroll-underpayment");
  const orgs: number[] = [], actors: number[] = [];
  const code = (re: string) => new RegExp("^" + re + "$");
  const rejectsCode = (promise: Promise<unknown>, expected: string) =>
    assert.rejects(promise, (error: unknown) => error instanceof cases.SalaryCorrectionCaseError && code(expected).test(error.code));
  try {
    for (let i = 0; i < 2; i++) { const [o] = await db.insert(s.organizations).values({ name: "Fictional correction " + randomUUID(), legalName: "Fictional" }).returning(); orgs.push(o.id); }
    for (let i = 0; i < 3; i++) { const [u] = await db.insert(s.users).values({ name: "Fictional actor " + i, email: randomUUID() + "@example.test", passwordHash: "not-login" }).returning(); actors.push(u.id); }
    const maker = { id: actors[0], name: "Fictional maker" }, checker = { id: actors[1], name: "Fictional checker" }, other = { id: actors[2], name: "Fictional other operator" };
    const [entity] = await db.insert(s.legalEntities).values({ organizationId: orgs[0], code: "FICT", legalName: "Fictional Employer Inc.", displayName: "Fictional" }).returning();
    const [worker] = await db.insert(s.employees).values({ organizationId: orgs[0], legalEntityId: entity.id, employeeNo: "FICT-1", firstName: "Fictional", lastName: "Worker", title: "QA", avatarInitials: "FW", basicRate: "20000", startDate: "2025-01-06" }).returning();
    await db.insert(s.employeePayProfiles).values({ organizationId: orgs[0], employeeId: worker.id, payBasis: "monthly", rateAmount: "20000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
    const releasedRun = async (periodStart: string, periodEnd: string, status = "Released") => {
      const [run] = await db.insert(s.payrollRuns).values({ organizationId: orgs[0], legalEntityId: entity.id, periodLabel: periodStart, periodStart, periodEnd, payDate: periodEnd, status }).returning();
      const [entry] = await db.insert(s.payrollEntries).values({ payrollRunId: run.id, employeeId: worker.id, grossPay: "10000.00", deductions: "1000.00", netPay: "9000.00", lineItems: [{ code: "BASIC", amount: 10000 }] }).returning();
      return { run, entry };
    };
    const input = {
      organizationId: orgs[0], legalEntityId: entity.id, employeeId: worker.id, effectiveDate: "2026-09-10",
      correctedPayBasis: "monthly" as const, correctedRateCents: BigInt(2_200_000), evidenceReference: "HR memo FICT-2026-09",
      reason: "Approved increase effective 10 September was never encoded in payroll.", idempotencyKey: "fict-case-key-0001", expectedLatestRevisionId: null,
    };

    // Window, input and evidence rules.
    await rejectsCode(cases.createCorrectionCase({ ...input, effectiveDate: "2026-10-21" }, maker, NOW), "EFFECTIVE_DATE_NOT_PAST");
    await rejectsCode(cases.createCorrectionCase({ ...input, effectiveDate: "2025-12-16" }, maker, NOW), "PRIOR_TAX_YEAR");
    await rejectsCode(cases.createCorrectionCase(input, maker, NOW), "NO_AFFECTED_RUNS");
    await rejectsCode(cases.createCorrectionCase({ ...input, organizationId: orgs[1] }, maker, NOW), "EMPLOYEE_NOT_FOUND");
    await rejectsCode(cases.createCorrectionCase({ ...input, expectedLatestRevisionId: 999 }, maker, NOW), "STALE_PAY_HISTORY");
    assert.throws(() => cases.parseCaseInput({ ...input, correctedRateAmount: "22000.005", correctedRateCents: undefined }),
      (error: unknown) => error instanceof cases.SalaryCorrectionCaseError && error.code === "INVALID_INPUT");

    const before = await releasedRun("2026-08-16", "2026-08-31");
    const a = await releasedRun("2026-09-01", "2026-09-15");
    const b = await releasedRun("2026-09-16", "2026-09-30");

    // Create, replay and duplicate rules (concurrent replay included).
    const [first, second] = await Promise.all([cases.createCorrectionCase(input, maker, NOW), cases.createCorrectionCase(input, maker, NOW)]);
    assert.deepEqual([first.replayed, second.replayed].sort(), [false, true]);
    const correction = first.replayed ? second.correction : first.correction;
    const runs = await db.select().from(s.salaryCorrectionCaseRuns).where(eq(s.salaryCorrectionCaseRuns.caseId, correction.id));
    assert.deepEqual(runs.map((r) => r.payrollRunId).sort(), [a.run.id, b.run.id].sort(), "Only Released runs ending on/after the effective date");
    assert.ok(!runs.some((r) => r.payrollRunId === before.run.id));
    const runA = runs.find((r) => r.payrollRunId === a.run.id)!, runB = runs.find((r) => r.payrollRunId === b.run.id)!;
    assert.ok((await cases.listCorrectionCases(orgs[0], entity.id)).some((c) => c.id === correction.id));
    assert.equal((await cases.listCorrectionCases(orgs[0], entity.id + 1000)).length, 0,
      "A different legal employer must not see this correction case");
    await rejectsCode(cases.createCorrectionCase({ ...input, correctedRateCents: BigInt(2_300_000) }, maker, NOW), "IDEMPOTENCY_KEY_REUSED");
    await rejectsCode(cases.createCorrectionCase({ ...input, evidenceReference: "Different signed HR ticket" }, maker, NOW), "IDEMPOTENCY_KEY_REUSED");
    await rejectsCode(cases.createCorrectionCase({ ...input, reason: "The source memo was replaced by a different correction." }, maker, NOW), "IDEMPOTENCY_KEY_REUSED");
    await rejectsCode(cases.createCorrectionCase({ ...input, legalEntityId: entity.id + 1000 }, maker, NOW), "IDEMPOTENCY_KEY_REUSED");
    await rejectsCode(cases.createCorrectionCase({ ...input, expectedLatestRevisionId: 77 }, maker, NOW), "IDEMPOTENCY_KEY_REUSED");
    await rejectsCode(cases.createCorrectionCase(input, other, NOW), "IDEMPOTENCY_KEY_REUSED");
    await rejectsCode(cases.createCorrectionCase({ ...input, idempotencyKey: "fict-case-key-0002" }, maker, NOW), "ACTIVE_CASE_EXISTS");

    // Tenant and maker scoping.
    await rejectsCode(cases.decideCaseRun(orgs[1], correction.id, { kind: "clear", runId: runA.id }, maker), "CASE_NOT_FOUND");
    await rejectsCode(cases.submitCorrectionCase(orgs[1], correction.id, "0", maker), "CASE_NOT_FOUND");
    await rejectsCode(cases.decideCaseRun(orgs[0], correction.id, { kind: "clear", runId: runA.id }, other), "NOT_CASE_MAKER");

    const underpayment = async (source: { run: { id: number }; entry: typeof a.entry }, amount: string) => {
      const [row] = await db.insert(s.payrollUnderpaymentRequests).values({
        organizationId: orgs[0], employeeId: worker.id, sourcePayrollRunId: source.run.id, sourcePayrollEntryId: source.entry.id,
        sourceEntryHash: payrollSourceFingerprint(source.entry), amount, effectiveDate: "2026-11-15",
        reason: "Independent recalculation of the basic-pay shortfall.", evidenceReference: "Recalc FICT-0001",
        status: "pending_review", requestedByUserId: maker.id, requestedBy: maker.name,
      }).returning();
      return row;
    };
    const requestA = await underpayment(a, "1234.56");
    await rejectsCode(cases.decideCaseRun(orgs[0], correction.id, { kind: "link", runId: runB.id, underpaymentRequestId: requestA.id }, maker), "REQUEST_MISMATCH");
    await cases.decideCaseRun(orgs[0], correction.id, { kind: "link", runId: runA.id, underpaymentRequestId: requestA.id }, maker);

    // Completeness, forward rate, reconciliation; failures roll back.
    await rejectsCode(cases.submitCorrectionCase(orgs[0], correction.id, "1234.56", maker), "CASE_INCOMPLETE");
    await rejectsCode(cases.decideCaseRun(orgs[0], correction.id, { kind: "no_shortfall", runId: runB.id, reason: "too short" }, maker), "INVALID_INPUT");
    await cases.decideCaseRun(orgs[0], correction.id, { kind: "no_shortfall", runId: runB.id, reason: "Unpaid leave for the whole cutoff; no basic pay was due." }, maker);
    await rejectsCode(cases.submitCorrectionCase(orgs[0], correction.id, "1234.56", maker), "FORWARD_RATE_NOT_APPLIED");
    await db.update(s.employeePayProfiles).set({ rateAmount: "22000.00" }).where(eq(s.employeePayProfiles.employeeId, worker.id));
    await rejectsCode(cases.submitCorrectionCase(orgs[0], correction.id, "1234.55", maker), "TOTAL_MISMATCH");
    await rejectsCode(cases.submitCorrectionCase(orgs[0], correction.id, "1234.56", other), "NOT_CASE_MAKER");
    const [stillDraft] = await db.select().from(s.salaryCorrectionCases).where(eq(s.salaryCorrectionCases.id, correction.id));
    assert.equal(stillDraft.status, "draft");
    assert.equal(stillDraft.declaredTotal, null);

    // An in-progress run for the period blocks submission (may use the old rate).
    const draft = await releasedRun("2026-10-01", "2026-10-15", "Draft");
    await rejectsCode(cases.submitCorrectionCase(orgs[0], correction.id, "1234.56", maker), "RUN_IN_PROGRESS");
    await db.delete(s.payrollEntries).where(eq(s.payrollEntries.id, draft.entry.id));
    await db.delete(s.payrollRuns).where(eq(s.payrollRuns.id, draft.run.id));

    // A newly Released run blocks until refreshed and decided.
    const late = await releasedRun("2026-10-01", "2026-10-15");
    await rejectsCode(cases.submitCorrectionCase(orgs[0], correction.id, "1234.56", maker), "AFFECTED_RUNS_CHANGED");
    assert.deepEqual(await cases.refreshCaseRuns(orgs[0], correction.id, maker), { added: 1 });
    const [runLate] = await db.select().from(s.salaryCorrectionCaseRuns).where(and(eq(s.salaryCorrectionCaseRuns.caseId, correction.id), eq(s.salaryCorrectionCaseRuns.payrollRunId, late.run.id)));
    await rejectsCode(cases.submitCorrectionCase(orgs[0], correction.id, "1234.56", maker), "CASE_INCOMPLETE");
    await cases.decideCaseRun(orgs[0], correction.id, { kind: "no_shortfall", runId: runLate.id, reason: "Calculated after the forward rate was applied." }, maker);

    // Concurrent submits: exactly one wins.
    const submits = await Promise.allSettled([
      cases.submitCorrectionCase(orgs[0], correction.id, "1234.56", maker),
      cases.submitCorrectionCase(orgs[0], correction.id, "1234.56", maker),
    ]);
    assert.equal(submits.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((submits.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.code, "CASE_NOT_EDITABLE");
    await rejectsCode(cases.decideCaseRun(orgs[0], correction.id, { kind: "clear", runId: runB.id }, maker), "CASE_NOT_EDITABLE");

    // Maker-checker in the application and in the database.
    await rejectsCode(cases.reviewCorrectionCase(orgs[0], correction.id, "approve", "Reviewed against independent recalculation.", maker), "SELF_REVIEW");
    await assert.rejects(db.update(s.salaryCorrectionCases).set({ status: "approved", reviewedByUserId: maker.id }).where(eq(s.salaryCorrectionCases.id, correction.id)));

    // Source evidence changed after submission blocks approval.
    await db.update(s.payrollEntries).set({ netPay: "9000.01" }).where(eq(s.payrollEntries.id, a.entry.id));
    await rejectsCode(cases.reviewCorrectionCase(orgs[0], correction.id, "approve", "Reviewed against independent recalculation.", checker), "SOURCE_CHANGED");
    await db.update(s.payrollEntries).set({ netPay: "9000.00" }).where(eq(s.payrollEntries.id, a.entry.id));

    // Linked request rejected after submission blocks approval; return and resubmit.
    await db.update(s.payrollUnderpaymentRequests).set({ status: "rejected" }).where(eq(s.payrollUnderpaymentRequests.id, requestA.id));
    await rejectsCode(cases.reviewCorrectionCase(orgs[0], correction.id, "approve", "Reviewed against independent recalculation.", checker), "LINKED_REQUEST_INVALID");
    const returned = await cases.reviewCorrectionCase(orgs[0], correction.id, "reject", "Linked underpayment was rejected; recalculate run A.", checker);
    assert.equal(returned.status, "changes_requested");
    const requestA2 = await underpayment(a, "1200.00");
    await rejectsCode(cases.decideCaseRun(orgs[0], correction.id, { kind: "link", runId: runA.id, underpaymentRequestId: requestA.id }, maker), "REQUEST_NOT_LINKABLE");
    await cases.decideCaseRun(orgs[0], correction.id, { kind: "link", runId: runA.id, underpaymentRequestId: requestA2.id }, maker);
    await cases.submitCorrectionCase(orgs[0], correction.id, "1200.00", maker);
    const approved = await cases.reviewCorrectionCase(orgs[0], correction.id, "approve", "Reviewed against independent recalculation.", checker);
    assert.equal(approved.status, "approved");
    assert.equal(approved.declaredTotal, "1200.00");
    await rejectsCode(cases.cancelCorrectionCase(orgs[0], correction.id, "Trying to cancel an approved case.", maker), "CASE_NOT_OPEN");

    // Case approval moves no money: no supplementary earning exists, request still pending its own review.
    assert.equal((await db.select().from(s.supplementaryEarnings).where(eq(s.supplementaryEarnings.organizationId, orgs[0]))).length, 0);
    assert.equal((await db.select().from(s.payrollUnderpaymentRequests).where(eq(s.payrollUnderpaymentRequests.id, requestA2.id)))[0].status, "pending_review");

    // A later case cannot reuse a linked request; cancellation frees its links.
    const next = await cases.createCorrectionCase({ ...input, idempotencyKey: "fict-case-key-0003" }, maker, NOW);
    const nextRuns = await db.select().from(s.salaryCorrectionCaseRuns).where(eq(s.salaryCorrectionCaseRuns.caseId, next.correction.id));
    assert.deepEqual(nextRuns.map((r) => r.payrollRunId).sort(), [a.run.id, b.run.id, late.run.id].sort());
    const nextRunA = nextRuns.find((r) => r.payrollRunId === a.run.id)!;
    await rejectsCode(cases.decideCaseRun(orgs[0], next.correction.id, { kind: "link", runId: nextRunA.id, underpaymentRequestId: requestA2.id }, maker), "REQUEST_ALREADY_LINKED");
    const requestB = await underpayment(b, "50.00");
    const nextRunB = nextRuns.find((r) => r.payrollRunId === b.run.id)!;
    await cases.decideCaseRun(orgs[0], next.correction.id, { kind: "link", runId: nextRunB.id, underpaymentRequestId: requestB.id }, maker);
    await rejectsCode(cases.cancelCorrectionCase(orgs[0], next.correction.id, "Duplicate of an HR ticket handled elsewhere.", other), "NOT_CASE_MAKER");
    assert.equal((await db.select().from(s.salaryCorrectionCaseRuns)
      .where(eq(s.salaryCorrectionCaseRuns.caseId, next.correction.id)))
      .find((r) => r.id === nextRunB.id)?.underpaymentRequestId, requestB.id, "Rejected cancellation must preserve linked evidence");
    const cancelled = await cases.cancelCorrectionCase(orgs[0], next.correction.id, "Duplicate of an HR ticket handled elsewhere.", maker);
    assert.equal(cancelled.status, "cancelled");
    const withdrawn = await db.select().from(s.salaryCorrectionCaseRuns).where(eq(s.salaryCorrectionCaseRuns.caseId, next.correction.id));
    assert.ok(withdrawn.every((r) => r.disposition === "withdrawn" && r.underpaymentRequestId === null));
    const [cancelAudit] = await db.select().from(s.auditEvents).where(and(eq(s.auditEvents.organizationId, orgs[0]), eq(s.auditEvents.action, "Salary correction case cancelled")));
    assert.match(JSON.stringify(cancelAudit.metadata), new RegExp(`"underpaymentRequestId":${requestB.id}`));
    const reopened = await cases.createCorrectionCase({ ...input, idempotencyKey: "fict-case-key-0004" }, maker, NOW);
    const reopenedRunB = (await db.select().from(s.salaryCorrectionCaseRuns).where(and(eq(s.salaryCorrectionCaseRuns.caseId, reopened.correction.id), eq(s.salaryCorrectionCaseRuns.payrollRunId, b.run.id))))[0];
    await cases.decideCaseRun(orgs[0], reopened.correction.id, { kind: "link", runId: reopenedRunB.id, underpaymentRequestId: requestB.id }, maker);
    await rejectsCode(cases.decideCaseRun(orgs[0], reopened.correction.id, { kind: "link", runId: reopenedRunB.id, underpaymentRequestId: requestA2.id }, maker), "REQUEST_MISMATCH");

    // Every step is audited for the employer.
    const audits = await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, orgs[0]));
    for (const action of ["opened", "run decided", "refreshed", "submitted", "returned for changes", "approved", "cancelled"]) {
      assert.ok(audits.some((row) => row.action === "Salary correction case " + action), "audit: " + action);
    }
    assert.equal((await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, orgs[1]))).length, 0);
  } finally {
    if (orgs.length) {
      await db.delete(s.salaryCorrectionCaseRuns).where(inArray(s.salaryCorrectionCaseRuns.organizationId, orgs));
      await db.delete(s.salaryCorrectionCases).where(inArray(s.salaryCorrectionCases.organizationId, orgs));
      await db.delete(s.payrollUnderpaymentRequests).where(inArray(s.payrollUnderpaymentRequests.organizationId, orgs));
      const runIds = (await db.select({ id: s.payrollRuns.id }).from(s.payrollRuns).where(inArray(s.payrollRuns.organizationId, orgs))).map((r) => r.id);
      if (runIds.length) await db.delete(s.payrollEntries).where(inArray(s.payrollEntries.payrollRunId, runIds));
      await db.delete(s.payrollRuns).where(inArray(s.payrollRuns.organizationId, orgs));
      await db.delete(s.employeePayProfiles).where(inArray(s.employeePayProfiles.organizationId, orgs));
      await db.delete(s.employees).where(inArray(s.employees.organizationId, orgs));
      await db.delete(s.legalEntities).where(inArray(s.legalEntities.organizationId, orgs));
      // Audit chain 0109 is deliberately append-only. Keep these fictional
      // organization and audit rows until the disposable CI database is dropped;
      // do not weaken the production audit trigger just to clean up test data.
    }
    if (actors.length) await db.delete(s.users).where(inArray(s.users.id, actors));
    await pool.end();
  }
});

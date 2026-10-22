/**
 * #641 salary correction case tenant proof: fictional PostgreSQL rows and
 * production-mode localhost HTTP only. Case actions never move money; no
 * underpayment is posted and no provider is contacted. Runs only inside the
 * dedicated isolated CI job with HCM_SALARY_CORRECTION_CASES_ENABLED=true.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, employeePayProfiles, employees, payrollEntries, payrollRuns,
  salaryCorrectionCaseRuns, salaryCorrectionCases, sessions, users,
} from "../../src/db/schema";

function philippineToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

export async function verifySalaryCorrectionCaseTenantIsolation(f, { request, expectStatus }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.TENANT_641_SALARY_CORRECTION_CASE_PROOF, "isolated-ci-only");
  const victim = f.orgs[0];
  // Use an actual past date in the current Philippine tax year that is not
  // covered by another Released run for either fictional owner. The shared
  // high-risk proof legitimately releases October 16-31, so "yesterday" can
  // collide with payroll_runs_no_overlapping_release. Never weaken that guard.
  const today = philippineToday();
  const year = today.slice(0, 4);
  const priorDay = (isoDate) => {
    const day = new Date(isoDate + "T00:00:00Z");
    day.setUTCDate(day.getUTCDate() - 1);
    return day.toISOString().slice(0, 10);
  };
  const ownerReleasedPeriods = await Promise.all([1, 2].map((idx) =>
    db.select({ periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.organizationId, f.orgs[idx].id),
        eq(payrollRuns.legalEntityId, f.entities[idx].id),
        eq(payrollRuns.status, "Released")))));
  let effectiveDate;
  for (let day = priorDay(today); day >= year + "-01-02"; day = priorDay(day)) {
    const available = ownerReleasedPeriods.every((runs) => runs.every((run) =>
      day < run.periodStart || day > run.periodEnd));
    if (available) { effectiveDate = day; break; }
  }
  assert.ok(effectiveDate, "No unoccupied past payroll day in the current tax year for fictional salary-case proof");
  assert.equal(effectiveDate.slice(0, 4), year, "Proof needs a past date in the current tax year (not 1 January)");

  // A real victim-only case with a real Released source run, high ID included.
  const [victimCase] = await db.insert(salaryCorrectionCases).values({
    organizationId: victim.id, legalEntityId: f.entities[0].id, employeeId: f.victimEmployee.id,
    idempotencyKey: "victim-only-" + randomUUID().replaceAll("-", ""), effectiveDate,
    correctedPayBasis: "monthly", correctedRateAmount: "21000.00", evidenceReference: "Victim-only fictional memo",
    reason: "Victim-only fictional correction used as a cross-employer target.",
    requestedByUserId: f.owners[0].id, requestedBy: f.owners[0].name,
  }).returning();
  const [victimEntry] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, f.victimRun.id)).limit(1);
  const [victimCaseRun] = await db.insert(salaryCorrectionCaseRuns).values({
    organizationId: victim.id, caseId: victimCase.id, payrollRunId: f.victimRun.id, payrollEntryId: victimEntry.id,
    sourceEntryHash: "0".repeat(64), periodStart: "2026-10-01", periodEnd: "2026-10-15",
  }).returning();
  const victimCasesBefore = await db.select().from(salaryCorrectionCases).where(eq(salaryCorrectionCases.organizationId, victim.id));
  const victimCaseRunsBefore = await db.select().from(salaryCorrectionCaseRuns).where(eq(salaryCorrectionCaseRuns.organizationId, victim.id));
  const victimAuditBefore = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, victim.id));

  for (const idx of [1, 2]) {
    const org = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    // Only fictional fixture users/sessions receive a verified MFA timestamp.
    await db.update(users).set({ totpEnabled: true }).where(eq(users.id, f.owners[idx].id));
    await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, f.ownerSessions[idx].id));
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, legalEntityId: f.entities[idx].id, employeeNo: "SC641-" + idx + "-" + randomUUID().slice(0, 8),
      firstName: "CorrectionOwn" + idx, lastName: "Synthetic", title: "Fictional", avatarInitials: "CS",
      basicRate: "21000.00", startDate: today.slice(0, 4) + "-01-01",
    }).returning();
    await db.insert(employeePayProfiles).values({ organizationId: org.id, employeeId: worker.id, payBasis: "monthly",
      rateAmount: "21000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
    const [run] = await db.insert(payrollRuns).values({ organizationId: org.id, legalEntityId: f.entities[idx].id,
      periodLabel: "SC641 fictional", periodStart: effectiveDate, periodEnd: effectiveDate, payDate: effectiveDate, status: "Released" }).returning();
    await db.insert(payrollEntries).values({ payrollRunId: run.id, employeeId: worker.id, grossPay: "1000.00", deductions: "0.00", netPay: "1000.00" });
    const body = {
      organizationId: org.id, legalEntityId: f.entities[idx].id, employeeId: worker.id, effectiveDate,
      correctedPayBasis: "monthly", correctedRateAmount: "21000.00", evidenceReference: "Fictional HR memo " + idx,
      reason: "Fictional backdated increase that payroll never encoded.", idempotencyKey: "own-case-" + idx + "-" + randomUUID().replaceAll("-", ""),
    };

    const ownCaseCreate = expectStatus(await request("/api/hcm/salary-corrections/cases", { method: "POST", cookie,
      body }), 201, "Owned correction case opens with its Released run snapshot");
    const caseId = ownCaseCreate.json?.correction?.id;
    assert.equal(ownCaseCreate.json?.correction?.organizationId, org.id);
    assert.deepEqual(ownCaseCreate.json?.runs?.map((row) => row.payrollRunId), [run.id]);
    expectStatus(await request("/api/hcm/salary-corrections/cases", { method: "POST", cookie,
      body: { ...body, organizationId: victim.id, legalEntityId: f.entities[0].id, employeeId: f.victimEmployee.id } }), 403, "Victim employer case POST is denied");
    expectStatus(await request("/api/hcm/salary-corrections/cases", { method: "POST", cookie,
      body: { ...body, employeeId: f.victimEmployee.id, idempotencyKey: body.idempotencyKey + "x" } }), 404, "Victim worker cannot be named inside own employer");

    const ownCaseRead = expectStatus(await request("/api/hcm/salary-corrections/cases?organizationId=" + org.id, { cookie }), 200, "Owned cases are listed");
    assert.ok(ownCaseRead.json?.cases?.some((row) => row.id === caseId && row.organizationId === org.id), "Own case must be present");
    assert.ok(ownCaseRead.json.cases.every((row) => row.id !== victimCase.id), "Victim case must not be listed");
    expectStatus(await request("/api/hcm/salary-corrections/cases?organizationId=" + victim.id, { cookie }), 403, "Victim employer cases are not readable");

    const ownCasePatch = expectStatus(await request("/api/hcm/salary-corrections/cases", { method: "PATCH", cookie,
      body: { organizationId: org.id, caseId, action: "mark_no_shortfall", caseRunId: ownCaseCreate.json.runs[0].id,
        reason: "Fictional cutoff had no basic pay shortfall." } }), 200, "Owned case run decision persists");
    assert.equal(ownCasePatch.json?.run?.disposition, "no_shortfall");
    const [storedRun] = await db.select().from(salaryCorrectionCaseRuns).where(eq(salaryCorrectionCaseRuns.caseId, caseId));
    assert.equal(storedRun.disposition, "no_shortfall");
    expectStatus(await request("/api/hcm/salary-corrections/cases", { method: "PATCH", cookie,
      body: { organizationId: victim.id, caseId: victimCase.id, action: "mark_no_shortfall", caseRunId: victimCaseRun.id,
        reason: "Forged cross-employer decision attempt." } }), 403, "Victim employer case PATCH is denied");
    expectStatus(await request("/api/hcm/salary-corrections/cases", { method: "PATCH", cookie,
      body: { organizationId: org.id, caseId: victimCase.id, action: "cancel", reason: "Forged victim case cancellation." } }), 404, "Victim case does not resolve inside own employer");
  }

  const victimCasesAfter = await db.select().from(salaryCorrectionCases).where(eq(salaryCorrectionCases.organizationId, victim.id));
  assert.deepEqual(victimCasesAfter, victimCasesBefore, "Denied case writes leave victim cases unchanged");
  const victimCaseRunsAfter = await db.select().from(salaryCorrectionCaseRuns).where(eq(salaryCorrectionCaseRuns.organizationId, victim.id));
  assert.deepEqual(victimCaseRunsAfter, victimCaseRunsBefore, "Denied case writes leave victim case runs unchanged");
  const victimAuditAfter = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, victim.id));
  assert.deepEqual(victimAuditAfter, victimAuditBefore, "Denied case writes add no victim audit events");
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const enabled = process.env.PAYROLL_RECOVERY_PROOF_MODE === "disposable-only";
function isAuditVeto(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("FICTIONAL_RECOVERY_AUDIT_VETO")
    || (error.cause !== undefined && isAuditVeto(error.cause)));
}
if (enabled) {
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(target.protocol, "postgresql:");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "5432");
  assert.equal(target.username, "postgres");
  assert.equal(target.search + target.hash, "");
  assert.ok(/^\/payroll_recovery_\d{8}_[a-f0-9]{8}$/.test(target.pathname)
    || (target.pathname === "/app_db" && process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true"));
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY", "SMTP_URL"]) {
    assert.equal(Boolean(process.env[key]), false, key);
  }
  for (const key of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED"]) {
    assert.notEqual(process.env[key], "true", key);
  }
}

test("PG: audit veto rolls back queue replacement and final calculation; retries commit exactly once", {
  skip: !enabled, timeout: 120000,
}, async () => {
  const { db, pool } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { eq, and, inArray } = await import("drizzle-orm");
  const { enqueuePayrollRun, processNextPayrollJob } = await import("../src/lib/payroll-engine");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const trigger = "qa_recovery_veto_" + suffix;
  let orgId = 0;
  try {
    const [org, victim] = await db.insert(s.organizations).values([
      { name: "Fictional recovery " + suffix, legalName: "Fictional recovery" },
      { name: "Fictional untouched " + suffix, legalName: "Fictional untouched" },
    ]).returning();
    orgId = org.id;
    for (const employer of [org, victim]) {
      const [employee] = await db.insert(s.employees).values({
        organizationId: employer.id, employeeNo: "RECOVERY-" + employer.id,
        firstName: "Fictional", lastName: "Recovery", title: "QA only", avatarInitials: "QA",
        basicRate: "30000", startDate: "2025-01-01", restDay: "Sunday",
      }).returning();
      await db.insert(s.employeePayProfiles).values({ organizationId: employer.id, employeeId: employee.id,
        payBasis: "monthly", rateAmount: "30000", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
    }
    const [run] = await db.insert(s.payrollRuns).values({
      organizationId: org.id, periodLabel: "Fictional recovery cutoff", periodStart: "2026-10-01",
      periodEnd: "2026-10-15", payDate: "2026-10-15", status: "Draft", scopeLabel: "All locations",
    }).returning();
    const snapshot = async (organizationId: number) => ({
      runs: await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId, organizationId)),
      jobs: await db.select().from(s.payrollJobs).where(eq(s.payrollJobs.organizationId, organizationId)),
      entries: await db.select().from(s.payrollEntries).where(inArray(s.payrollEntries.payrollRunId,
        db.select({ id: s.payrollRuns.id }).from(s.payrollRuns).where(eq(s.payrollRuns.organizationId, organizationId)))),
      payslips: await db.select().from(s.payslips).where(eq(s.payslips.organizationId, organizationId)),
      audit: await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, organizationId)),
    });
    const victimBefore = await snapshot(victim.id);
    const auditCount = async (action: string) => (await db.select().from(s.auditEvents)
      .where(and(eq(s.auditEvents.organizationId, org.id), eq(s.auditEvents.action, action)))).length;
    const veto = async (action: string) => {
      assert.ok(["Payroll job queued", "Payroll calculation completed"].includes(action));
      await pool.query(`CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.organization_id = ${org.id} AND NEW.action = '${action}' THEN
          RAISE EXCEPTION 'FICTIONAL_RECOVERY_AUDIT_VETO'; END IF; RETURN NEW; END $$`);
      await pool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
    };
    const removeVeto = () => pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_events`);

    const original = await snapshot(org.id);
    await veto("Payroll job queued");
    await assert.rejects(enqueuePayrollRun(run.id), isAuditVeto);
    assert.deepEqual(await snapshot(org.id), original, "Failed enqueue cannot leave a queued run or unaudited job");
    await removeVeto();
    const racing = await Promise.allSettled([enqueuePayrollRun(run.id), enqueuePayrollRun(run.id)]);
    assert.equal(racing.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(racing.filter(result => result.status === "rejected").length, 1);
    assert.equal((await snapshot(org.id)).jobs.length, 1);
    assert.equal(await auditCount("Payroll job queued"), 1);

    await veto("Payroll calculation completed");
    await assert.rejects(processNextPayrollJob("fictional-veto", run.id), isAuditVeto);
    const failed = await snapshot(org.id);
    assert.equal(failed.runs[0].status, "Failed");
    assert.equal(failed.runs[0].processedChunks, 0);
    assert.equal(Number(failed.runs[0].grossPay), 0);
    assert.equal(failed.jobs[0].status, "failed");
    assert.equal(failed.jobs[0].chunkIndex, 0);
    assert.equal(failed.entries.length, 0, "Unaudited completion must roll back the calculated register");
    assert.equal(failed.payslips.length, 0);
    assert.equal(await auditCount("Payroll calculation completed"), 0);
    await removeVeto();

    await Promise.all([processNextPayrollJob("fictional-retry-a", run.id), processNextPayrollJob("fictional-retry-b", run.id)]);
    const saved = await snapshot(org.id);
    assert.equal(saved.runs[0].status, "Needs review");
    assert.equal(saved.runs[0].processedChunks, 1);
    assert.equal(saved.jobs[0].status, "completed");
    assert.equal(saved.entries.length, 1);
    assert.equal(Number(saved.entries[0].grossPay), 15000);
    assert.ok(Number(saved.entries[0].netPay) > 0);
    assert.equal(saved.payslips.length, 1);
    assert.equal(await auditCount("Payroll calculation completed"), 1);
    assert.equal((await processNextPayrollJob("fictional-lost-response-retry", run.id)).processed, false);
    assert.deepEqual(await snapshot(org.id), saved, "A lost-response retry must not add another chunk or audit");

    // Existing calculated evidence must also survive an audit-vetoed recalculation.
    await veto("Payroll job queued");
    await assert.rejects(enqueuePayrollRun(run.id), isAuditVeto);
    assert.deepEqual(await snapshot(org.id), saved, "Destructive replacement rolls back existing register and payslip IDs too");
    assert.deepEqual(await snapshot(victim.id), victimBefore, "Other employer remains unchanged throughout");
  } finally {
    if (orgId) {
      await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_events`);
      await pool.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
    }
    await pool.end();
  }
});
